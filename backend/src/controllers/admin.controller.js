const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { env } = require('../config/env');
const { findDataset } = require('../config/datasetCatalog');
const User = require('../models/User');
const Driver = require('../models/Driver');
const Alert = require('../models/Alert');
const TrainingJob = require('../models/TrainingJob');
const ModelRelease = require('../models/ModelRelease');
const HttpError = require('../utils/httpError');
const runner = require('../services/trainingRunner');
const registry = require('../services/modelRegistry');
const datasetStore = require('../services/datasetStore');
const fpVerifier = require('../services/fpVerifier');
const statusStore = require('../services/statusStore');

/** A driver is "online" while the in-car device has reported within this window (same as the apps). */
const ONLINE_MS = 30_000;

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
const folderName = z
  .string()
  .regex(/^[\w.-]{1,60}$/, 'folder must be a simple name inside VIDEO_DATASETS_DIR');

const jobSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fetch_dataset'), params: z.object({ datasetId: z.string() }) }),
  z.object({
    type: z.literal('train_verifier'),
    params: z
      .object({
        includeFeedback: z.boolean().default(true),
        recordings: z
          .array(z.string().regex(/^[\w.-]{1,60}$/))
          .max(20)
          .default([]),
      })
      .default({}),
  }),
  z.object({
    type: z.literal('train_eye_state'),
    params: z.object({ datasets: z.array(z.string()).min(1).max(5) }),
  }),
  z.object({ type: z.literal('calibrate_yawn'), params: z.object({ datasetId: z.string() }) }),
  z.object({
    type: z.literal('process_videos'),
    params: z.object({
      folder: folderName,
      preset: z.enum(['rldd', 'folders']),
      limit: z.number().int().min(0).max(10000).optional(),
    }),
  }),
  z.object({ type: z.literal('import_uploads'), params: z.object({}).default({}) }),
]);

const uploadSchema = z.object({
  name: z.string().min(1).max(120),
  content: z
    .string()
    .min(2)
    .max(10 * 1024 * 1024),
});

// ------------------------------------------------------------------------------- overview
async function overview(req, res) {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [parents, drivers, alerts7d, byType, labelled, falseAlarms, active, lastJob] =
    await Promise.all([
      User.countDocuments({ role: { $ne: 'admin' } }),
      Driver.countDocuments(),
      Alert.countDocuments({ createdAt: { $gte: since } }),
      Alert.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$type', n: { $sum: 1 } } },
      ]),
      Alert.countDocuments({ 'feedback.falseAlarm': { $exists: true } }),
      Alert.countDocuments({ 'feedback.falseAlarm': true }),
      ModelRelease.find({ status: 'active' }),
      TrainingJob.findOne().sort({ createdAt: -1 }),
    ]);
  const verifier = fpVerifier.getModel();
  res.json({
    counts: {
      parents,
      drivers,
      alerts7d,
      alertsByType: Object.fromEntries(byType.map((t) => [t._id, t.n])),
    },
    feedback: {
      labelled,
      falseAlarms,
      falseAlarmRate: labelled ? Math.round((falseAlarms / labelled) * 1000) / 1000 : null,
    },
    models: {
      fp_verifier: active.find((r) => r.kind === 'fp_verifier')?.toPublic() || {
        bundled: true,
        threshold: verifier ? verifier.threshold : null,
        trainedAt: verifier && verifier.meta ? verifier.meta.trained_at : null,
      },
      eye_state: active.find((r) => r.kind === 'eye_state')?.toPublic() || { bundled: true },
      yawn_threshold: active.find((r) => r.kind === 'yawn_threshold')?.toPublic() || {
        bundled: true,
        yawnMar: 0.5,
      },
    },
    worker: await runner.effectiveWorker(),
    lastJob: lastJob ? lastJob.toPublic() : null,
  });
}

// ------------------------------------------------------------------------------- parents
function isOnline(driverId, now) {
  const s = statusStore.get(driverId);
  return Boolean(s && s.lastUpdate && now - new Date(s.lastUpdate).getTime() <= ONLINE_MS);
}

/** GET /admin/parents: every account with its drivers and alert activity. */
async function parents(_req, res) {
  const now = Date.now();
  const since = new Date(now - 7 * 24 * 3600 * 1000);
  const [users, drivers, alertAgg] = await Promise.all([
    User.find().select('+googleId +passwordHash').sort({ createdAt: -1 }).limit(2000),
    Driver.find().select('parentId name relationship enrollment createdAt').sort({ createdAt: 1 }),
    Alert.aggregate([
      {
        $group: {
          _id: '$parentId',
          total: { $sum: 1 },
          last7d: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } },
          lastAt: { $max: '$createdAt' },
        },
      },
    ]),
  ]);
  const alertsBy = new Map(alertAgg.map((a) => [a._id.toString(), a]));
  const driversBy = new Map();
  for (const d of drivers) {
    const key = d.parentId.toString();
    if (!driversBy.has(key)) driversBy.set(key, []);
    driversBy.get(key).push({
      id: d._id.toString(),
      name: d.name,
      relationship: d.relationship,
      faceEnrolled: Boolean(d.enrollment && d.enrollment.photoCount > 0),
      online: isOnline(d._id.toString(), now),
      createdAt: d.createdAt,
    });
  }
  const rows = users.map((u) => {
    const id = u._id.toString();
    const own = driversBy.get(id) || [];
    const a = alertsBy.get(id);
    const google = Boolean(u.googleId);
    const password = Boolean(u.passwordHash);
    return {
      id,
      name: u.name,
      email: u.email,
      role: u.role,
      emailVerified: u.emailVerified !== false,
      signIn: google && password ? 'google+password' : google ? 'google' : 'password',
      createdAt: u.createdAt,
      drivers: own,
      driverCount: own.length,
      onlineDrivers: own.filter((d) => d.online).length,
      alertsTotal: a ? a.total : 0,
      alerts7d: a ? a.last7d : 0,
      lastAlertAt: a ? a.lastAt : null,
    };
  });
  res.json({
    parents: rows,
    totals: {
      accounts: rows.length,
      parents: rows.filter((r) => r.role !== 'admin').length,
      unverified: rows.filter((r) => !r.emailVerified).length,
      drivers: drivers.length,
      onlineDrivers: rows.reduce((n, r) => n + r.onlineDrivers, 0),
    },
  });
}

// ------------------------------------------------------------------------------- datasets
async function datasets(_req, res) {
  const data = await datasetStore.listDatasets();
  // Training runs on a laptop: show what is downloaded THERE (its heartbeat snapshot); feedback
  // counts come from the shared database and are always current.
  if (!runner.workerInfo().enabled) {
    const remote = await runner.remoteWorker();
    if (remote && remote.datasets) {
      res.json({ ...remote.datasets, feedback: data.feedback, worker: remote.host || remote._id });
      return;
    }
  }
  res.json(data);
}

async function uploadRecording(req, res) {
  if (!runner.workerInfo().enabled) {
    throw new HttpError(
      409,
      'Training runs on your worker laptop: copy the .jsonl file into ml/data/raw/uploads there, then start "Import uploaded recordings".',
    );
  }
  try {
    const saved = datasetStore.saveUpload(req.body.name, req.body.content);
    res.status(201).json(saved);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}

// ------------------------------------------------------------------------------- jobs
async function validateJob({ type, params }) {
  const worker = await runner.effectiveWorker();
  if (!worker.enabled) {
    throw new HttpError(503, `Training worker unavailable: ${worker.problems.join('; ')}`);
  }
  const needsMonitor = type === 'calibrate_yawn' || type === 'process_videos';
  if (needsMonitor && !worker.monitorPython) {
    throw new HttpError(503, 'This job needs the driver_monitor Python (MONITOR_PYTHON).');
  }
  // Catalog checks work anywhere; file checks only where the files are (a remote worker reports a
  // clear error in the job log instead).
  const local = worker.mode === 'local';
  if (type === 'fetch_dataset' || type === 'calibrate_yawn') {
    const ds = findDataset(params.datasetId);
    const task = type === 'fetch_dataset' ? 'eye_state' : 'yawn_calibration';
    if (!ds || ds.task !== task)
      throw new HttpError(400, `Dataset ${params.datasetId} can't be used for this job`);
  }
  if (type === 'train_eye_state') {
    for (const id of params.datasets) {
      const ds = findDataset(id);
      if (!ds || ds.task !== 'eye_state') throw new HttpError(400, `${id} is not an eye dataset`);
      if (!local) continue;
      const stats = path.join(env.ml.mlDir, 'data', runner.eyeDir(id), 'eyes.npz');
      if (!fs.existsSync(stats)) throw new HttpError(409, `Download "${ds.title}" first`);
    }
  }
  if (!local) return;
  if (type === 'train_verifier') {
    const have = new Set(datasetStore.recordingSets().map((r) => r.name));
    const missing = params.recordings.filter((r) => !have.has(r));
    if (missing.length) throw new HttpError(409, `Unknown recording sets: ${missing.join(', ')}`);
  }
  if (type === 'process_videos') {
    const folder = path.join(env.ml.videosDir, params.folder);
    if (!fs.existsSync(folder)) throw new HttpError(409, `Folder not found: ${folder}`);
  }
  if (type === 'import_uploads') {
    const dir = path.join(env.ml.mlDir, 'data', 'raw', 'uploads');
    if (!fs.existsSync(dir) || !fs.readdirSync(dir).some((f) => f.endsWith('.jsonl'))) {
      throw new HttpError(409, 'Upload recordings first');
    }
  }
}

async function createJob(req, res) {
  const parsed = jobSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Invalid job', parsed.error.flatten());
  await validateJob(parsed.data);
  const job = await TrainingJob.create({ ...parsed.data, startedBy: req.user.parentId });
  runner.kick().catch(() => {});
  res.status(201).json({ job: job.toPublic() });
}

async function listJobs(_req, res) {
  const [jobs, busy] = await Promise.all([
    TrainingJob.find().sort({ createdAt: -1 }).limit(50),
    TrainingJob.exists({ status: 'running' }),
  ]);
  res.json({ jobs: jobs.map((j) => j.toPublic()), busy: Boolean(busy) });
}

async function getJob(req, res) {
  if (!objectId.safeParse(req.params.id).success) throw new HttpError(400, 'Invalid id');
  const job = await TrainingJob.findById(req.params.id);
  if (!job) throw new HttpError(404, 'Job not found');
  res.json({ job: job.toPublic({ withLog: true }) });
}

async function cancelJob(req, res) {
  if (!objectId.safeParse(req.params.id).success) throw new HttpError(400, 'Invalid id');
  const job = await runner.cancel(req.params.id);
  if (!job) throw new HttpError(404, 'Job not found');
  res.json({ job: job.toPublic() });
}

// ------------------------------------------------------------------------------- models
async function listModels(_req, res) {
  const releases = await ModelRelease.find().sort({ createdAt: -1 }).limit(100);
  res.json({ releases: releases.map((r) => r.toPublic()) });
}

async function getModel(req, res) {
  if (!objectId.safeParse(req.params.id).success) throw new HttpError(400, 'Invalid id');
  const release = await ModelRelease.findById(req.params.id).select('+report +metrics');
  if (!release) throw new HttpError(404, 'Model not found');
  res.json({ release: { ...release.toPublic(), metrics: release.metrics } });
}

async function promoteModel(req, res) {
  if (!objectId.safeParse(req.params.id).success) throw new HttpError(400, 'Invalid id');
  const release = await registry.promote(req.params.id, req.user.parentId);
  res.json({ release: release.toPublic() });
}

async function resetModel(req, res) {
  const kind = req.params.kind;
  if (!ModelRelease.KINDS.includes(kind)) throw new HttpError(400, 'Unknown model kind');
  await registry.resetKind(kind);
  res.json({ ok: true });
}

module.exports = {
  overview,
  parents,
  datasets,
  uploadRecording,
  createJob,
  listJobs,
  getJob,
  cancelJob,
  listModels,
  getModel,
  promoteModel,
  resetModel,
  uploadSchema,
  jobSchema,
};
