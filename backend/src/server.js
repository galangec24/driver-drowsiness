const http = require('http');
const { env, assertRequired } = require('./config/env');
const logger = require('./config/logger');
const { connectDb, disconnectDb } = require('./config/db');
const { createApp } = require('./app');
const { initSockets } = require('./sockets');
const { scheduleAdaptiveTuning } = require('./services/adaptiveTuner');
const { loadFaceModels } = require('./config/faceApi');
const { loadModel: loadFpVerifier } = require('./services/fpVerifier');
const Driver = require('./models/Driver');
const modelRegistry = require('./services/modelRegistry');
const trainingRunner = require('./services/trainingRunner');
const sensorRollup = require('./services/sensorRollup');
const snapshotCleanup = require('./services/snapshotCleanup');
const { ensureViews } = require('./config/dbViews');

/** Drivers created before name uniqueness existed get their nameKey (duplicates are reported). */
async function backfillDriverNameKeys() {
  const missing = await Driver.find({ nameKey: { $exists: false } }).select('parentId name');
  for (const d of missing) {
    const nameKey = Driver.nameKeyOf(d.name);
    const clash = await Driver.exists({ parentId: d.parentId, nameKey, _id: { $ne: d._id } });
    if (clash) {
      logger.warn(
        { driverId: d._id.toString(), name: d.name },
        'duplicate driver name — rename it',
      );
    } else {
      await Driver.updateOne({ _id: d._id }, { nameKey });
    }
  }
  await Driver.syncIndexes();
}

async function start() {
  assertRequired();
  await connectDb(env.mongoUri);
  await backfillDriverNameKeys().catch((err) =>
    logger.warn({ err: err.message }, 'driver name backfill failed'),
  );

  await ensureViews().catch((err) => logger.warn({ err: err.message }, 'database views failed'));

  const app = createApp();
  const server = http.createServer(app);
  // Render's load balancer reuses connections for longer than Node's 5 s default; closing them
  // first makes requests fail with 502 under load. Keep sockets open longer than the proxy does.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  initSockets(server);

  // Face models load in the background; enrollment returns 503 until ready.
  loadFaceModels().catch((err) => logger.warn({ err: err.message }, 'face models unavailable'));
  const tuningTask = scheduleAdaptiveTuning();
  // Per-minute summaries of the readings (history screen, reports): once a minute.
  const rollupTask = sensorRollup.schedule();
  // Alert photos whose alert is gone (e.g. deleted in the database): at start and daily.
  const photoCleanupTask = snapshotCleanup.schedule();
  if (env.fpVerifier) {
    loadFpVerifier();
    // An admin-promoted verifier (stored in MongoDB) replaces the bundled file.
    await modelRegistry
      .loadActiveVerifier()
      .catch((err) => logger.warn({ err: err.message }, 'could not load promoted verifier'));
    modelRegistry.startVerifierSync();
  }
  trainingRunner
    .recover()
    .catch((err) => logger.warn({ err: err.message }, 'training queue recovery failed'));
  const worker = trainingRunner.workerInfo();
  logger.info({ enabled: worker.enabled, problems: worker.problems }, 'training worker');

  server.listen(env.port, '0.0.0.0', () => {
    logger.info(`Guardian Drive backend listening on http://0.0.0.0:${env.port}`);
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    tuningTask.stop();
    rollupTask.stop();
    photoCleanupTask.stop();
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
