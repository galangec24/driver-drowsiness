const { env } = require('../config/env');
const Alert = require('../models/Alert');
const Driver = require('../models/Driver');
const SensorLog = require('../models/SensorLog');
const { computeDrowsinessScore, resolveThresholds } = require('./fusionEngine');
const alertDispatcher = require('./alertDispatcher');
const statusStore = require('./statusStore');
const signalWindow = require('./signalWindow');
const fpVerifier = require('./fpVerifier');
const { computeFeatures, MIN_TICKS } = require('./fpFeatures');

// Last alert time per `${driverId}:${type}` — stops a 1 Hz feed from creating 1 alert/second.
const lastAlertAt = new Map();
// When each driver's location was last written to Mongo (throttles Driver.lastLocation writes).
const locationSavedAt = new Map();
const LOCATION_PERSIST_MS = 10 * 1000;
// A fix older than this is not attached to a new alert ("where it happened" must be accurate).
const LOCATION_FRESH_MS = 2 * 60 * 1000;
// Yawning alerts are about a trend (count over 5 min), so they repeat far less often.
const YAWN_COOLDOWN_MS = 5 * 60 * 1000;
// Nodding is dangerous: re-alert after a minute if the driver keeps nodding.
const NOD_COOLDOWN_MS = 60 * 1000;
// Direct, debounced camera observations: they don't go through the false-alarm verifier.
const OBSERVED_TYPES = new Set(['yawning', 'nodding']);
// Device clocks this far from the server's are ignored (a Raspberry Pi has no battery-backed
// clock and boots at a stale time until NTP syncs) — the server's receive time is used instead.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Device timestamp if plausible, else the server time. */
function resolveTimestamp(raw, now) {
  if (!raw) return new Date(now);
  const t = new Date(raw);
  if (Number.isNaN(t.getTime()) || Math.abs(t.getTime() - now) > MAX_CLOCK_SKEW_MS) {
    return new Date(now);
  }
  return t;
}

function resetCooldowns() {
  lastAlertAt.clear();
  locationSavedAt.clear();
  signalWindow.clear();
}

/** Payload location → stored shape (rounded; ~1 m precision is plenty). */
function normalizeLocation(loc, at) {
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
  const out = { lat: round(loc.lat, 6), lng: round(loc.lng, 6), at: at.toISOString() };
  if (typeof loc.heading === 'number') out.heading = round(loc.heading, 1);
  if (typeof loc.speed === 'number') out.speed = round(loc.speed, 1);
  if (typeof loc.accuracy === 'number') out.accuracy = round(loc.accuracy, 1);
  return out;
}

/** This tick's fix, else the last known one if it is still fresh. */
function currentLocation(driverId, tickLocation, now) {
  if (tickLocation) return tickLocation;
  const prev = statusStore.get(driverId);
  const loc = prev && prev.location;
  if (loc && now - new Date(loc.at).getTime() <= LOCATION_FRESH_MS) return loc;
  return null;
}

function persistLocation(driver, location, now) {
  const id = driver._id.toString();
  const last = locationSavedAt.get(id);
  if (last !== undefined && now - last < LOCATION_PERSIST_MS) return;
  locationSavedAt.set(id, now);
  // Fire-and-forget: never adds to ingest latency.
  Driver.updateOne({ _id: driver._id }, { lastLocation: location }).catch(() => {});
}

function round(v, digits = 4) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * Map a fusion classification to an Alert type. Microsleep = drowsy with eyes far below the
 * driver's *personal* EAR threshold and PERCLOS above their personal limit.
 */
function alertTypeFor(classification, signals, driver, components = {}) {
  if (components.nodEscalated) return 'nodding';
  if (components.yawnEscalated) return 'yawning';
  if (classification === 'warning') return 'warning';
  if (classification !== 'drowsy') return null;
  const t = resolveThresholds(driver);
  const deepClosure =
    typeof signals.ear === 'number' &&
    signals.ear < t.earThreshold * 0.5 &&
    typeof signals.perclos === 'number' &&
    signals.perclos >= t.perclosThreshold;
  return deepClosure ? 'microsleep' : 'drowsy';
}

function inCooldown(driverId, type, now) {
  const last = lastAlertAt.get(`${driverId}:${type}`);
  const cooldown =
    { yawning: YAWN_COOLDOWN_MS, nodding: NOD_COOLDOWN_MS }[type] ?? env.alertCooldownMs;
  return last !== undefined && now - last < cooldown;
}

/** Optional wearable/yawn signals, kept only when present (SensorLog, status, alerts). */
function extraSignals(signals) {
  const out = {};
  const keys = [
    'hrv',
    'hrBaseline',
    'yawnCount',
    'nodCount',
    'mar',
    'breathingRate',
    'breathingBaseline',
  ];
  for (const k of keys) {
    if (typeof signals[k] === 'number') out[k] = signals[k];
  }
  return out;
}

/**
 * False-positive verifier gate for a candidate alert. Returns { allow, score, threshold }.
 * Abstains (allow) when disabled, when no model is loaded, or with < MIN_TICKS of history.
 */
function verifyCandidate(window, driver) {
  const model = fpVerifier.getModel();
  if (!env.fpVerifier || !model || window.length < MIN_TICKS) {
    return { allow: true, score: null, threshold: null };
  }
  const threshold = env.fpVerifierThreshold ?? model.threshold;
  const score = fpVerifier.predict(computeFeatures(window, resolveThresholds(driver)), model);
  return { allow: score >= threshold, score, threshold, modelVersion: model.version };
}

async function createAlert(driver, type, confidence, signals, timestamp, verifier, location) {
  const alert = await Alert.create({
    driverId: driver._id,
    parentId: driver.parentId,
    type,
    confidence: round(Math.min(1, Math.max(0, confidence)), 3),
    sensorSnapshot: {
      ear: signals.ear,
      perclos: signals.perclos,
      heartRate: signals.heartRate,
      ...(typeof signals.hrv === 'number' && { hrv: signals.hrv }),
      ...(typeof signals.yawnCount === 'number' && { yawnCount: signals.yawnCount }),
      ...(typeof signals.nodCount === 'number' && { nodCount: signals.nodCount }),
      ...(typeof signals.breathingRate === 'number' && { breathingRate: signals.breathingRate }),
      timestamp,
    },
    ...(location && { location }),
    ...(verifier && { verifier }),
  });
  const pub = alert.toPublic({ driverName: driver.name });
  alertDispatcher.dispatchNewAlert(pub);
  return pub;
}

/**
 * Steps 4–6 of backend/CLAUDE.md § 7: fuse, always persist SensorLog, alert if not 'alert'.
 * @returns {{classification, fusionScore, alertTriggered, alertId}}
 */
async function processIngest(driver, payload) {
  const { signals, source } = payload;
  const now = Date.now();
  const timestamp = resolveTimestamp(payload.timestamp, now);
  const driverId = driver._id.toString();
  const tickLocation = normalizeLocation(payload.location, timestamp);
  const location = currentLocation(driverId, tickLocation, now);
  if (tickLocation) persistLocation(driver, tickLocation, now);

  // 4. Fusion
  const { fusionScore: raw, classification, components } = computeDrowsinessScore(signals, driver);
  const fusionScore = round(raw);
  const window = signalWindow.push(driverId, {
    t: now,
    ear: signals.ear,
    perclos: signals.perclos,
    heartRate: signals.heartRate,
    faceConfidence: signals.faceConfidence,
    fusionScore,
  });

  // Candidate alert type + verifier verdict (pure computation; side effects follow in order).
  const type = alertTypeFor(classification, signals, driver, components);
  // The verifier models eye/heart-rate confounders; a yawn count is a direct, debounced
  // observation, so yawning alerts don't go through it.
  const verdict = type && !OBSERVED_TYPES.has(type) ? verifyCandidate(window, driver) : null;

  // 5. SensorLog — always, even for 'alert'
  const logPromise = SensorLog.create({
    driverId: driver._id,
    signals: {
      ear: signals.ear,
      perclos: signals.perclos,
      heartRate: signals.heartRate,
      faceConfidence: signals.faceConfidence,
      ...extraSignals(signals),
    },
    classification,
    fusionScore,
    source,
    ...(verdict && verdict.score !== null && { verifierScore: round(verdict.score, 4) }),
    ...(tickLocation && { location: tickLocation }),
  });

  // 6. Alert (non-'alert' classifications) → false-positive verifier → per-type cooldown
  let alertId = null;
  const alertPromises = [];
  const allowed = OBSERVED_TYPES.has(type) || (verdict && verdict.allow);
  if (type && allowed && !inCooldown(driverId, type, now)) {
    lastAlertAt.set(`${driverId}:${type}`, now);
    const verifier =
      !verdict || verdict.score === null
        ? null
        : {
            score: round(verdict.score, 4),
            threshold: verdict.threshold,
            modelVersion: verdict.modelVersion,
            window: window.map(({ t, ...rest }) => ({ ...rest, t: t / 1000 })),
          };
    alertPromises.push(
      createAlert(driver, type, fusionScore, signals, timestamp, verifier, location),
    );
  }
  // Someone other than the registered driver is behind the wheel.
  if (
    signals.matchedDriver &&
    signals.matchedDriver !== driverId &&
    !inCooldown(driverId, 'face_match', now)
  ) {
    lastAlertAt.set(`${driverId}:face_match`, now);
    alertPromises.push(
      createAlert(
        driver,
        'face_match',
        signals.faceConfidence ?? 1,
        signals,
        timestamp,
        null,
        location,
      ),
    );
  }

  const [, ...alerts] = await Promise.all([logPromise, ...alertPromises]);
  if (alerts.length) alertId = alerts[0].id;

  const status = {
    driverId,
    status: classification,
    lastUpdate: timestamp.toISOString(),
    fusionScore,
    signals: {
      ear: signals.ear,
      perclos: signals.perclos,
      heartRate: signals.heartRate,
      faceConfidence: signals.faceConfidence,
      ...extraSignals(signals),
    },
    source,
    ...(payload.wearable && { wearable: payload.wearable }),
    ...(payload.radar && { radar: payload.radar }),
    // Last known fix (kept across ticks without GPS); null if none yet.
    location,
  };
  statusStore.set(driverId, status);
  alertDispatcher.dispatchDriverStatus(driver.parentId.toString(), status);

  return { classification, fusionScore, alertTriggered: alertId !== null, alertId };
}

module.exports = { processIngest, alertTypeFor, resetCooldowns, resolveTimestamp };
