/**
 * Which trained model is live. One `active` ModelRelease per kind; none = the version bundled with
 * the code (backend/src/ml/fp-verifier.json, driver_monitor/models/eye_state.json, YAWN_MAR 0.5).
 */
const ModelRelease = require('../models/ModelRelease');
const fpVerifier = require('./fpVerifier');
const logger = require('../config/logger');
const HttpError = require('../utils/httpError');

// Small in-memory cache for the per-reading ingest path (thresholds endpoint polls every 5 min).
let cache = { at: 0, eyeStateVersion: null, yawnMar: null };
const CACHE_MS = 30_000;

function invalidate() {
  cache = { at: 0, eyeStateVersion: null, yawnMar: null };
}

async function deviceSettings() {
  if (Date.now() - cache.at < CACHE_MS) return cache;
  const [eye, yawn] = await Promise.all([
    ModelRelease.findOne({ kind: 'eye_state', status: 'active' }).select('_id'),
    ModelRelease.findOne({ kind: 'yawn_threshold', status: 'active' }).select('+artifact'),
  ]);
  cache = {
    at: Date.now(),
    eyeStateVersion: eye ? eye._id.toString() : null,
    yawnMar: yawn && yawn.artifact ? yawn.artifact.yawnMar : null,
  };
  return cache;
}

let loadedVerifierId = null; // release id currently in memory (null = bundled file)

/** At startup: a promoted verifier replaces the bundled one. */
async function loadActiveVerifier() {
  const active = await ModelRelease.findOne({ kind: 'fp_verifier', status: 'active' }).select(
    '+artifact',
  );
  if (!active) return null;
  try {
    fpVerifier.setModel(active.artifact);
    loadedVerifierId = active._id.toString();
    logger.info({ release: loadedVerifierId }, 'promoted fp verifier loaded');
    return active;
  } catch (err) {
    logger.warn({ err: err.message }, 'promoted fp verifier invalid, keeping the bundled model');
    return null;
  }
}

async function promote(id, userId) {
  const release = await ModelRelease.findById(id).select('+artifact');
  if (!release) throw new HttpError(404, 'Model not found');
  if (release.kind === 'fp_verifier') {
    try {
      fpVerifier.setModel(release.artifact); // validates before anything changes
    } catch (err) {
      throw new HttpError(400, `Model cannot be loaded: ${err.message}`);
    }
  }
  await ModelRelease.updateMany(
    { kind: release.kind, status: 'active', _id: { $ne: release._id } },
    { status: 'retired' },
  );
  if (release.kind === 'fp_verifier') loadedVerifierId = release._id.toString();
  release.status = 'active';
  release.promotedAt = new Date();
  release.promotedBy = userId;
  await release.save();
  invalidate();
  return release;
}

/** Back to the version bundled with the code. */
async function resetKind(kind) {
  await ModelRelease.updateMany({ kind, status: 'active' }, { status: 'retired' });
  if (kind === 'fp_verifier') {
    fpVerifier.loadModel();
    loadedVerifierId = null;
  }
  invalidate();
}

/**
 * Several backends can share one database (e.g. training/promotion on a PC, the public API on
 * Render). Each checks once a minute and switches to whatever verifier is active in the database.
 */
async function syncVerifier() {
  const active = await ModelRelease.findOne({ kind: 'fp_verifier', status: 'active' }).select(
    '_id',
  );
  const wanted = active ? active._id.toString() : null;
  if (wanted === loadedVerifierId) return false;
  if (wanted) {
    await loadActiveVerifier();
  } else {
    fpVerifier.loadModel();
    loadedVerifierId = null;
  }
  return true;
}

function startVerifierSync(intervalMs = 60_000) {
  const timer = setInterval(() => {
    syncVerifier().catch((err) => logger.warn({ err: err.message }, 'verifier sync failed'));
  }, intervalMs);
  timer.unref();
  return timer;
}

async function activeEyeModel() {
  return ModelRelease.findOne({ kind: 'eye_state', status: 'active' }).select('+artifact');
}

module.exports = {
  loadActiveVerifier,
  syncVerifier,
  startVerifierSync,
  promote,
  resetKind,
  deviceSettings,
  activeEyeModel,
  invalidate,
};
