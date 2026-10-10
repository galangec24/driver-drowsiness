const cron = require('node-cron');
const logger = require('../config/logger');
const Driver = require('../models/Driver');
const SensorLog = require('../models/SensorLog');

/**
 * Adaptive per-driver EAR threshold. Once a day, look at the last 7 days of SensorLog for each
 * driver and recompute earThreshold from that driver's own open-eye baseline.
 *
 * Eyes are open most of the time, so a high percentile of EAR is a robust estimate of the
 * driver's personal open-eye EAR regardless of how samples were classified (no feedback loop).
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
  if (!result) return { driverId: driver._id.toString(), skipped: true, samples: rows.length };

  driver.personalThresholds.earThreshold = result.earThreshold;
  driver.lastTunedAt = now;
  await driver.save();
  return { driverId: driver._id.toString(), skipped: false, ...result };
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

/** Daily at 03:00 server time. Returns the cron task (call .stop() on shutdown). */
function scheduleAdaptiveTuning(expression = '0 3 * * *') {
  return cron.schedule(expression, () => {
    tuneAllDrivers().catch((err) => logger.error({ err }, 'adaptive tuning crashed'));
  });
}

module.exports = { computeEarThreshold, tuneDriver, tuneAllDrivers, scheduleAdaptiveTuning, TUNER };
