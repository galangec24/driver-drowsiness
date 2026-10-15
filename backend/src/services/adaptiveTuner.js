const cron = require('node-cron');
const logger = require('../config/logger');
const Driver = require('../models/Driver');
const SensorLog = require('../models/SensorLog');
const Alert = require('../models/Alert');

/**
 * Automatic, per-driver sensitivity (parents never edit thresholds). Every hour, and right after a
 * parent marks an alert as real / false alarm:
 *
 * 1. Eyes: earThreshold follows the driver's own open-eye EAR (last 7 days). Eyes are open most of
 *    the time, so a high percentile is a robust estimate regardless of classification.
 * 2. Feedback: if most recent alerts were marked "False alarm", alerts for this driver need more
 *    evidence (PERCLOS, closure time, yawns) one step at a time; when alerts are confirmed real it
 *    steps back toward the defaults. Bounded so it can never switch alerts off.
 */
const TUNER = Object.freeze({
  windowDays: 7,
  minSamples: 300,
  baselinePercentile: 0.7,
  closureRatio: 0.75, // threshold = 75% of open-eye EAR
  smoothing: 0.3, // weight of the new estimate vs. the current threshold
  minEar: 0.12,
  maxEar: 0.35,
});

/** Feedback-driven sensitivity: one step per tuning run, within safe bounds. */
const SENSITIVITY = Object.freeze({
  windowDays: 30,
  minLabelled: 3,
  relaxAbove: 0.5, // > half of the labelled alerts were false alarms → need more evidence
  restoreBelow: 0.2, // mostly real alarms → step back toward the defaults
  steps: {
    perclosThreshold: { step: 0.05, default: 0.4, max: 0.6 },
    drowsyDurationMs: { step: 250, default: 2000, max: 3500 },
    yawnThreshold: { step: 1, default: 3, max: 6 },
  },
});

/**
 * Pure: next values for the feedback-driven thresholds.
 * @param {{falseAlarms:number, real:number}} labels  parent feedback in the window
 * @returns {{values:object, mode:'learning'|'standard'|'reduced', falseAlarmRate:number|null}}
 */
function computeSensitivity(labels, current, opts = SENSITIVITY) {
  const total = labels.falseAlarms + labels.real;
  const values = {};
  for (const [k, s] of Object.entries(opts.steps)) {
    values[k] = Number.isFinite(current[k]) && current[k] > 0 ? current[k] : s.default;
  }
  if (total < opts.minLabelled) return { values, mode: 'learning', falseAlarmRate: null };
  const rate = labels.falseAlarms / total;
  for (const [k, s] of Object.entries(opts.steps)) {
    if (rate > opts.relaxAbove) values[k] = Math.min(s.max, values[k] + s.step);
    else if (rate < opts.restoreBelow) values[k] = Math.max(s.default, values[k] - s.step);
    values[k] = Math.round(values[k] * 1000) / 1000;
  }
  const relaxed = Object.entries(opts.steps).some(([k, s]) => values[k] > s.default);
  return {
    values,
    mode: relaxed ? 'reduced' : 'standard',
    falseAlarmRate: Math.round(rate * 100) / 100,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Pure function: compute a new EAR threshold from samples.
 * @returns {{earThreshold:number, baseline:number, samples:number} | null} null when not enough data
 */
function computeEarThreshold(earSamples, currentThreshold, opts = TUNER) {
  const clean = earSamples.filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (clean.length < opts.minSamples) return null;
  clean.sort((a, b) => a - b);
  const baseline = percentile(clean, opts.baselinePercentile);
  const target = Math.min(opts.maxEar, Math.max(opts.minEar, baseline * opts.closureRatio));
  const current = Number.isFinite(currentThreshold) ? currentThreshold : target;
  const next = current + opts.smoothing * (target - current);
  return {
    earThreshold: Math.round(next * 1000) / 1000,
    baseline: Math.round(baseline * 1000) / 1000,
    samples: clean.length,
  };
}

async function tuneDriver(driver, now = new Date()) {
  const since = new Date(now.getTime() - TUNER.windowDays * 24 * 3600 * 1000);
  const rows = await SensorLog.find({
    driverId: driver._id,
    createdAt: { $gte: since },
    'signals.ear': { $gt: 0 },
  })
    .select('signals.ear')
    .lean();

  const result = computeEarThreshold(
    rows.map((r) => r.signals.ear),
    driver.personalThresholds.earThreshold,
  );
  if (result) driver.personalThresholds.earThreshold = result.earThreshold;

  // Parent feedback ("False alarm" / "Real") in the last 30 days.
  const fbSince = new Date(now.getTime() - SENSITIVITY.windowDays * 24 * 3600 * 1000);
  const [falseAlarms, real] = await Promise.all([
    Alert.countDocuments({
      driverId: driver._id,
      createdAt: { $gte: fbSince },
      'feedback.falseAlarm': true,
    }),
    Alert.countDocuments({
      driverId: driver._id,
      createdAt: { $gte: fbSince },
      'feedback.falseAlarm': false,
    }),
  ]);
  const sens = computeSensitivity({ falseAlarms, real }, driver.personalThresholds);
  Object.assign(driver.personalThresholds, sens.values);

  driver.tuning = {
    mode: result || sens.mode !== 'learning' ? sens.mode : 'learning',
    eyeSamples: rows.length,
    eyeBaseline: result ? result.baseline : (driver.tuning?.eyeBaseline ?? null),
    falseAlarms,
    realAlarms: real,
    falseAlarmRate: sens.falseAlarmRate,
    updatedAt: now,
  };
  driver.lastTunedAt = now;
  await driver.save();
  return {
    driverId: driver._id.toString(),
    skipped: !result,
    samples: rows.length,
    ...(result || {}),
    mode: driver.tuning.mode,
  };
}

/** Re-tune one driver soon after new feedback (fire-and-forget). */
function retuneSoon(driverId) {
  Driver.findById(driverId)
    .then((d) => d && tuneDriver(d))
    .catch((err) => logger.warn({ driverId: String(driverId), err: err.message }, 'retune failed'));
}

async function tuneAllDrivers(now = new Date()) {
  const drivers = await Driver.find({});
  const results = [];
  for (const d of drivers) {
    try {
      results.push(await tuneDriver(d, now));
    } catch (err) {
      logger.warn({ driverId: d._id.toString(), err: err.message }, 'tuning failed');
    }
  }
  logger.info(
    { tuned: results.filter((r) => !r.skipped).length, total: results.length },
    'adaptive tuning done',
  );
  return results;
}

/** Every hour (minute 15). Returns the cron task (call .stop() on shutdown). */
function scheduleAdaptiveTuning(expression = '15 * * * *') {
  return cron.schedule(expression, () => {
    tuneAllDrivers().catch((err) => logger.error({ err }, 'adaptive tuning crashed'));
  });
}

module.exports = {
  computeEarThreshold,
  computeSensitivity,
  tuneDriver,
  tuneAllDrivers,
  retuneSoon,
  scheduleAdaptiveTuning,
  TUNER,
  SENSITIVITY,
};
