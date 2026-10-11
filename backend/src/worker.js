/**
 * Training worker for a machine with the ml/ Python environment (your laptop), when the API itself
 * runs somewhere without Python (Render):
 *
 *   cd guardian-drive/backend && npm run worker
 *
 * It uses the same MongoDB as the API (MONGO_URI in backend/.env, i.e. Atlas): it claims jobs that
 * admins queue on the website, runs them, saves logs + candidate models to the database, and sends a
 * heartbeat so the admin console shows "worker online". Promote models on the website as usual.
 */
const os = require('os');
const { env, assertRequired } = require('./config/env');
const logger = require('./config/logger');
const { connectDb, disconnectDb } = require('./config/db');
const runner = require('./services/trainingRunner');
const datasetStore = require('./services/datasetStore');
const WorkerStatus = require('./models/WorkerStatus');
const TrainingJob = require('./models/TrainingJob');

const HEARTBEAT_MS = 10_000;
const POLL_MS = 5_000;
const DATASETS_EVERY_MS = 60_000;

async function heartbeat(state) {
  const now = Date.now();
  const update = {
    host: os.hostname(),
    info: runner.workerInfo(),
    busy: runner.isBusy(),
    lastSeen: new Date(now),
  };
  if (now - state.datasetsAt > DATASETS_EVERY_MS || runner.isBusy() !== state.wasBusy) {
    update.datasets = await datasetStore.listDatasets().catch(() => null);
    state.datasetsAt = now;
  }
  state.wasBusy = update.busy;
  await WorkerStatus.updateOne({ _id: runner.workerId() }, { $set: update }, { upsert: true });
}

async function start() {
  assertRequired();
  const info = runner.workerInfo();
  if (!info.enabled) {
    logger.error(
      { problems: info.problems },
      'this machine cannot train: fix the problems above (docs/ADMIN.md)',
    );
    process.exit(1);
  }
  await connectDb(env.mongoUri);
  logger.info(
    { worker: runner.workerId(), ml: info.mlPython, monitor: info.monitorPython || 'not found' },
    'training worker online: queue jobs from the website admin console (Training tab)',
  );

  const state = { datasetsAt: 0, wasBusy: false };
  await heartbeat(state);
  await runner.recover();
  const beat = setInterval(
    () => heartbeat(state).catch((err) => logger.warn({ err: err.message }, 'heartbeat failed')),
    HEARTBEAT_MS,
  );
  const poll = setInterval(
    () => runner.kick().catch((err) => logger.warn({ err: err.message }, 'queue poll failed')),
    POLL_MS,
  );

  const shutdown = async (signal) => {
    logger.info({ signal }, 'training worker stopping');
    clearInterval(beat);
    clearInterval(poll);
    // A job cut off here can't resume: mark it failed so the queue moves on.
    await TrainingJob.updateMany(
      { status: 'running', worker: runner.workerId() },
      { status: 'failed', error: 'The training worker was stopped', finishedAt: new Date() },
    ).catch(() => {});
    await WorkerStatus.deleteOne({ _id: runner.workerId() }).catch(() => {});
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((err) => {
  logger.error({ err: err.message }, 'training worker failed to start');
  process.exit(1);
});
