/**
 * Admin training worker: runs ml/ (and driver_monitor) Python scripts as background jobs, one at a
 * time, streams their output to admins over Socket.io and turns results into ModelRelease candidates.
 *
 * Python is only needed where training runs. Two set-ups share the same MongoDB queue:
 *   - local:  the API server itself has the venvs (development on a laptop);
 *   - remote: the API runs without Python (Render) and `npm run worker` on a laptop claims queued
 *             jobs, writes logs/results to MongoDB and reports a heartbeat (WorkerStatus).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { env } = require('../config/env');
const logger = require('../config/logger');
const TrainingJob = require('../models/TrainingJob');
const ModelRelease = require('../models/ModelRelease');
const WorkerStatus = require('../models/WorkerStatus');
const { findDataset } = require('../config/datasetCatalog');
const { exportFeedback } = require('./feedbackExport');
const alertDispatcher = require('./alertDispatcher');

const LOG_CAP = 60_000; // characters of log tail kept per job
const SAVE_EVERY_MS = 2000;

// ------------------------------------------------------------------------------------ worker setup
function venvPython(dir) {
  const candidates = [
    path.join(dir, 'venv', 'Scripts', 'python.exe'),
    path.join(dir, 'venv', 'bin', 'python'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || '';
}

function workerInfo() {
  const ml = env.ml.python || venvPython(env.ml.mlDir);
  const monitor = env.ml.monitorPython || venvPython(env.ml.monitorDir);
  const problems = [];
  if (!fs.existsSync(env.ml.mlDir)) problems.push(`ml folder not found (${env.ml.mlDir})`);
  if (!ml) problems.push('ML_PYTHON not set and ml/venv not found: training jobs unavailable');
  if (!monitor) {
    problems.push(
      'MONITOR_PYTHON not set and driver_monitor/venv not found: yawn calibration and video jobs unavailable',
    );
  }
  return {
    enabled: Boolean(ml) && fs.existsSync(env.ml.mlDir),
    mlPython: ml || null,
    monitorPython: monitor || null,
    mlDir: env.ml.mlDir,
    videosDir: env.ml.videosDir,
    problems,
  };
}

/** A remote worker counts as online while its heartbeat is this fresh. */
const HEARTBEAT_FRESH_MS = 45_000;
const START_WORKER_HINT =
  'No training worker online. On your laptop run "npm run worker" in guardian-drive/backend (docs/ADMIN.md).';

function workerId() {
  return process.env.TRAINING_WORKER_ID || os.hostname();
}

/** The latest fresh heartbeat of a remote worker, or null. */
async function remoteWorker(now = Date.now()) {
  const w = await WorkerStatus.findOne({
    lastSeen: { $gte: new Date(now - HEARTBEAT_FRESH_MS) },
  }).sort({
    lastSeen: -1,
  });
  return w || null;
}

/**
 * Who will run jobs: this process (local venvs), a remote worker with a fresh heartbeat, or nobody.
 * Same shape as workerInfo() plus `mode` and `host`.
 */
async function effectiveWorker() {
  const local = workerInfo();
  if (local.enabled) return { ...local, mode: 'local', host: workerId() };
  const remote = await remoteWorker();
  if (remote && remote.info && remote.info.enabled) {
    return {
      ...remote.info,
      enabled: true,
      mode: 'remote',
      host: remote.host || remote._id,
      lastSeen: remote.lastSeen,
      problems: [],
    };
  }
  return { ...local, mode: 'none', host: null, problems: [...local.problems, START_WORKER_HINT] };
}

const dataPath = (...p) => path.join(env.ml.mlDir, 'data', ...p);
const exists = (p) => fs.existsSync(p);

/** ml/data folder of an eye dataset (the original Kaggle set predates the catalog: eyes_v1). */
function eyeDir(id) {
  return id === 'yawn-eye' ? 'eyes_v1' : `eyes_${id}`;
}

// ------------------------------------------------------------------------------------ job recipes
/**
 * Steps for a job. A step is either
 *   { label, python: 'ml'|'monitor', args: string[] | (ctx) => string[] }   (cwd = ml/)
 *   { label, run: async (ctx, log) => void }                                (in-process)
 */
function buildSteps(job) {
  const p = job.params || {};
  const out = `data/candidates/${job._id}`;
  switch (job.type) {
    case 'fetch_dataset': {
      const ds = findDataset(p.datasetId);
      return [
        {
          label: `Download ${ds.slug} from Kaggle`,
          python: 'ml',
          args: [
            'scripts/fetch_eye_data.py',
            '--dataset',
            ds.slug,
            '--open-dir',
            ds.classes.open,
            '--closed-dir',
            ds.classes.closed,
            '--out',
            `data/${eyeDir(ds.id)}`,
            ...(ds.perClass ? ['--per-class', String(ds.perClass)] : []),
          ],
        },
      ];
    }
    case 'train_verifier': {
      const steps = [];
      if (!exists(dataPath('synthetic_v1', 'ticks.csv.gz'))) {
        steps.push({
          label: 'Generate synthetic dataset (first run)',
          python: 'ml',
          args: ['scripts/make_dataset.py', '--drivers', '160', '--out', 'data/synthetic_v1'],
        });
      }
      if (!exists(dataPath('synthetic_shift', 'ticks.csv.gz'))) {
        steps.push({
          label: 'Generate shifted test population (first run)',
          python: 'ml',
          args: [
            'scripts/make_dataset.py',
            '--drivers',
            '60',
            '--seed',
            '99',
            '--stress',
            '--out',
            'data/synthetic_shift',
          ],
        });
      }
      if (p.includeFeedback !== false) {
        steps.push({
          label: 'Export parent false-alarm labels',
          run: async (ctx, log) => {
            const r = await exportFeedback(dataPath('feedback', 'alerts.jsonl'));
            ctx.feedback = r.labelled > 0 ? 'data/feedback/alerts.jsonl' : null;
            log(
              `exported ${r.labelled} labelled alerts (${r.falseAlarms} false alarms, ${r.withWindow} with signal window)\n`,
            );
          },
        });
      }
      steps.push({
        label: 'Train false-alarm verifier',
        python: 'ml',
        args: (ctx) => [
          'scripts/train.py',
          '--data',
          'data/synthetic_v1',
          '--shift-test',
          'data/synthetic_shift',
          ...(ctx.feedback ? ['--feedback', ctx.feedback] : []),
          ...(p.recordings || []).flatMap((name) => ['--extra', `data/recordings_${name}`]),
          '--out-dir',
          out,
        ],
      });
      return steps;
    }
    case 'train_eye_state': {
      const [first, ...rest] = p.datasets.map((id) => `data/${eyeDir(id)}`);
      return [
        {
          label: 'Train eye open/closed model',
          python: 'ml',
          args: [
            'scripts/train_eye_state.py',
            '--data',
            first,
            ...rest.flatMap((d) => ['--extra', d]),
            '--out-dir',
            out,
          ],
        },
      ];
    }
    case 'calibrate_yawn': {
      const ds = findDataset(p.datasetId);
      return [
        {
          label: `Calibrate yawn threshold on ${ds.slug}`,
          python: 'monitor',
          args: [
            'scripts/calibrate_yawn.py',
            '--dataset',
            ds.slug,
            '--yawn-dir',
            ds.classes.yawn,
            '--no-yawn-dir',
            ds.classes.noYawn,
            '--out-dir',
            out,
          ],
        },
      ];
    }
    case 'process_videos':
      return [
        {
          label: `Run the driver monitor over videos in ${p.folder}`,
          python: 'monitor',
          args: [
            'scripts/process_videos.py',
            path.join(env.ml.videosDir, p.folder),
            '--preset',
            p.preset,
            '--out',
            `data/raw/${p.folder}`,
            ...(p.limit ? ['--limit', String(p.limit)] : []),
          ],
        },
        {
          label: 'Import recordings',
          python: 'ml',
          args: [
            'scripts/import_recordings.py',
            `data/raw/${p.folder}`,
            '--out',
            `data/recordings_${p.folder}`,
          ],
        },
      ];
    case 'import_uploads':
      return [
        {
          label: 'Import uploaded recordings',
          python: 'ml',
          args: [
            'scripts/import_recordings.py',
            'data/raw/uploads',
            '--out',
            'data/recordings_uploads',
          ],
        },
      ];
    default:
      throw new Error(`unknown job type ${job.type}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** Turn a finished job's output folder into a candidate release (or null for data-only jobs). */
function collectRelease(job) {
  const dir = dataPath('candidates', job._id.toString());
  if (job.type === 'train_verifier') {
    const metrics = readJson(path.join(dir, 'metrics.json'));
    const learned = metrics.test_policies['learned verifier'];
    const baseline = metrics.test_policies['baseline (current backend)'];
    const shift = metrics.shift_policies && metrics.shift_policies['learned verifier'];
    return {
      kind: 'fp_verifier',
      artifact: readJson(path.join(dir, 'fp-verifier.json')),
      metrics,
      report: readText(path.join(dir, 'report.md')),
      summary: {
        threshold: metrics.threshold,
        falseAlertsPerHour: learned.false_alerts_per_hour,
        baselineFalseAlertsPerHour: baseline.false_alerts_per_hour,
        episodeRecall: learned.episode_recall,
        medianLatencyS: learned.median_detection_latency_s,
        shiftFalseAlertsPerHour: shift ? shift.false_alerts_per_hour : null,
        shiftRecall: shift ? shift.episode_recall : null,
        data: [metrics.dataset, ...(metrics.extra || [])],
        feedback: Boolean(metrics.feedback),
      },
    };
  }
  if (job.type === 'train_eye_state') {
    const metrics = readJson(path.join(dir, 'metrics.json'));
    return {
      kind: 'eye_state',
      artifact: readJson(path.join(dir, 'eye_state.json')),
      metrics,
      report: readText(path.join(dir, 'report.md')),
      summary: {
        accuracy: metrics.test.accuracy,
        webcamAccuracy: metrics.test.webcam_quality_accuracy,
        rocAuc: metrics.test.roc_auc,
        model: `${metrics.kind} ${JSON.stringify(metrics.selected)}`,
        datasets: metrics.datasets,
      },
    };
  }
  if (job.type === 'calibrate_yawn') {
    const result = readJson(path.join(dir, 'result.json'));
    return {
      kind: 'yawn_threshold',
      artifact: { yawnMar: result.recommended.threshold },
      metrics: result,
      report: readText(path.join(dir, 'report.md')),
      summary: {
        yawnMar: result.recommended.threshold,
        balancedAccuracy: result.recommended.balanced_accuracy,
        yawnsCaught: result.recommended.tpr,
        falseYawns: result.recommended.fpr,
        currentBalancedAccuracy: result.current.balanced_accuracy,
        dataset: result.dataset,
      },
    };
  }
  return null;
}

// ------------------------------------------------------------------------------------ runner
let running = null; // { jobId, child, cancelled }
let stepBuilder = buildSteps;
let releaseCollector = collectRelease;

function emit(event, payload) {
  alertDispatcher.emitToAdmins(event, payload);
}

async function runStep(step, ctx, log, info) {
  if (step.run) return step.run(ctx, log);
  const python = step.python === 'monitor' ? info.monitorPython : info.mlPython;
  if (!python)
    throw new Error(
      `${step.python === 'monitor' ? 'MONITOR_PYTHON' : 'ML_PYTHON'} is not available`,
    );
  const args = typeof step.args === 'function' ? step.args(ctx) : step.args;
  return new Promise((resolve, reject) => {
    const child = spawn(step.command || python, args, {
      cwd: step.cwd || env.ml.mlDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });
    running.child = child;
    child.stdout.on('data', (b) => log(b.toString()));
    child.stderr.on('data', (b) => log(b.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      running.child = null;
      if (running.cancelled) reject(new Error('cancelled'));
      else if (code === 0) resolve();
      else reject(new Error(`exited with code ${code}`));
    });
  });
}

/** `job` was already claimed (status 'running', worker = this one) by kick(). */
async function execute(job) {
  const info = workerInfo();
  running = { jobId: job._id.toString(), child: null, cancelled: false };
  emit('training:job', job.toPublic());

  // A cancel pressed on another server (e.g. Render) arrives as a flag on the job document.
  const cancelPoll = setInterval(() => {
    TrainingJob.exists({ _id: job._id, cancelRequested: true })
      .then((hit) => {
        if (hit && running && running.jobId === job._id.toString() && !running.cancelled) {
          running.cancelled = true;
          if (running.child) running.child.kill();
        }
      })
      .catch(() => {});
  }, 3000);

  let buffer = job.log;
  let lastSave = Date.now();
  const log = (text) => {
    buffer = (buffer + text).slice(-LOG_CAP);
    emit('training:log', { jobId: running.jobId, text });
    if (Date.now() - lastSave > SAVE_EVERY_MS) {
      lastSave = Date.now();
      TrainingJob.updateOne({ _id: job._id }, { log: buffer }).catch(() => {});
    }
  };

  const ctx = {};
  try {
    const steps = stepBuilder(job);
    for (const [i, step] of steps.entries()) {
      log(`\n▶ Step ${i + 1}/${steps.length}: ${step.label}\n`);
      await runStep(step, ctx, log, info);
    }
    const release = releaseCollector(job);
    if (release) {
      const doc = await ModelRelease.create({ ...release, jobId: job._id });
      job.releaseId = doc._id;
      log(
        `\n✔ Candidate ${release.kind} model saved. Review it under Models and promote it to go live.\n`,
      );
    }
    job.status = 'succeeded';
  } catch (err) {
    job.status = running.cancelled ? 'cancelled' : 'failed';
    job.error = running.cancelled ? 'Cancelled by admin' : err.message;
    log(`\n✖ ${job.error}\n`);
  } finally {
    clearInterval(cancelPoll);
    job.log = buffer;
    job.finishedAt = new Date();
    await job.save();
    running = null;
    emit('training:job', job.toPublic());
  }
}

/**
 * Start the next queued job if this process can train and is idle. Safe to call any time, from
 * several machines: the claim is atomic, so a job runs exactly once.
 */
async function kick() {
  if (running || !workerInfo().enabled) return;
  const next = await TrainingJob.findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'running', startedAt: new Date(), log: '', worker: workerId() } },
    { sort: { createdAt: 1 }, new: true },
  );
  if (!next) return;
  execute(next)
    .catch((err) => logger.error({ err: err.message }, 'training job crashed'))
    .finally(() => setImmediate(() => kick().catch(() => {})));
}

async function cancel(jobId) {
  const job = await TrainingJob.findById(jobId);
  if (!job) return null;
  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.finishedAt = new Date();
    await job.save();
    emit('training:job', job.toPublic());
  } else if (job.status === 'running' && running && running.jobId === jobId) {
    running.cancelled = true;
    if (running.child) running.child.kill();
  } else if (job.status === 'running') {
    // Running on another machine: its worker sees the flag within a few seconds.
    job.cancelRequested = true;
    await job.save();
  }
  return job;
}

/**
 * Jobs this worker left "running" (crash/restart) can't resume: mark them failed, then continue the
 * queue. Jobs claimed by another machine are left alone.
 */
async function recover() {
  await TrainingJob.updateMany(
    { status: 'running', $or: [{ worker: workerId() }, { worker: { $exists: false } }] },
    { status: 'failed', error: 'Interrupted by a server restart', finishedAt: new Date() },
  );
  await kick();
}

function isBusy() {
  return Boolean(running);
}

// Test hooks
function _setStepBuilder(fn) {
  stepBuilder = fn || buildSteps;
}
function _setReleaseCollector(fn) {
  releaseCollector = fn || collectRelease;
}

module.exports = {
  workerInfo,
  workerId,
  effectiveWorker,
  remoteWorker,
  HEARTBEAT_FRESH_MS,
  buildSteps,
  collectRelease,
  kick,
  cancel,
  recover,
  isBusy,
  eyeDir,
  _setStepBuilder,
  _setReleaseCollector,
};
