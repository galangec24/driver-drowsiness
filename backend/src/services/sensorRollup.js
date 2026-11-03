/**
 * Per-minute summaries of SensorLog (models/SensorMinute.js): MongoDB's "on-demand materialized
 * view". MongoDB has no stored procedures; this aggregation pipeline, run by the server every
 * minute and ending in $merge, plays that role.
 *
 * SensorLog.createdAt is the server's insert time (queued offline readings too), so it only grows:
 * each run summarises the minutes between the previous run and now, plus a short look-back for
 * inserts that were still in flight. Re-summarising a minute replaces its row, so runs are
 * idempotent. History asks minutesBetween(), which combines summaries with raw readings for the
 * edges that aren't summarised yet; the result is the same as grouping the raw readings.
 */
const SensorLog = require('../models/SensorLog');
const SensorMinute = require('../models/SensorMinute');
const logger = require('../config/logger');

const { RollupState } = SensorMinute;
const STATE_ID = 'sensor_minutes';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
// A reading is created (createdAt set) slightly before it is stored; wait this long for it.
const SETTLE_MS = 10 * 1000;
// Each run also redoes the last minutes before the previous mark (inserts that were slow).
const LOOKBACK_MS = 2 * MINUTE;

const floorMinute = (ms) => Math.floor(ms / MINUTE) * MINUTE;

/** SensorLog readings → one row per driver and minute (the figures the history screen shows). */
function minutePipeline(match) {
  const ms = { $toLong: '$createdAt' };
  return [
    { $match: match },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: { driverId: '$driverId', minute: { $subtract: [ms, { $mod: [ms, MINUTE] }] } },
        firstAt: { $first: '$createdAt' },
        lastAt: { $last: '$createdAt' },
        readings: { $sum: 1 },
        ear: { $avg: '$signals.ear' },
        perclos: { $avg: '$signals.perclos' },
        heartRate: { $avg: '$signals.heartRate' },
        maxScore: { $max: '$fusionScore' },
        drowsy: { $sum: { $cond: [{ $eq: ['$classification', 'drowsy'] }, 1, 0] } },
        warning: { $sum: { $cond: [{ $eq: ['$classification', 'warning'] }, 1, 0] } },
        locations: { $push: '$location' },
        source: { $last: '$source' },
      },
    },
    {
      $project: {
        _id: 0,
        driverId: '$_id.driverId',
        minute: { $toDate: '$_id.minute' },
        firstAt: 1,
        lastAt: 1,
        readings: 1,
        ear: 1,
        perclos: 1,
        heartRate: 1,
        maxScore: 1,
        drowsy: 1,
        warning: 1,
        source: 1,
        location: {
          $last: { $filter: { input: '$locations', cond: { $isNumber: '$$this.lat' } } },
        },
      },
    },
  ];
}

let running = null;

/** Summarise everything up to (now − SETTLE_MS) that isn't summarised yet. Single-flight. */
function rollUp(now = Date.now()) {
  if (!running) running = doRollUp(now).finally(() => (running = null));
  return running;
}

async function doRollUp(now) {
  const started = Date.now();
  const until = floorMinute(now - SETTLE_MS);
  const state = await RollupState.findById(STATE_ID).lean();
  let since = state && state.until ? state.until.getTime() - LOOKBACK_MS : null;
  if (since === null) {
    // First run: start at the oldest reading (insertion order follows createdAt).
    const first = await SensorLog.findOne().sort({ $natural: 1 }).select('createdAt').lean();
    since = first ? floorMinute(first.createdAt.getTime()) : until;
  }
  await SensorMinute.init(); // $merge needs the unique (driverId, minute) index to exist

  let windows = 0;
  // One day per aggregation keeps a first run over a large history within memory limits.
  for (let from = since; from < until; from += DAY) {
    const to = Math.min(from + DAY, until);
    await SensorLog.aggregate([
      ...minutePipeline({ createdAt: { $gte: new Date(from), $lt: new Date(to) } }),
      {
        $merge: {
          into: 'sensor_minutes',
          on: ['driverId', 'minute'],
          whenMatched: 'replace',
          whenNotMatched: 'insert',
        },
      },
    ]).allowDiskUse(true);
    windows += 1;
  }
  const lastMs = Date.now() - started;
  await RollupState.updateOne(
    { _id: STATE_ID },
    {
      $set: {
        until: new Date(Math.max(until, state?.until?.getTime() ?? 0)),
        runAt: new Date(),
        lastMs,
      },
    },
    { upsert: true },
  );
  return { until: new Date(until), windows, ms: lastMs };
}

/** Raw readings of one driver in [from, to) (or [from, to] when inclusive) → minute rows. */
function rawMinutes(driverId, from, to, inclusive = false) {
  const createdAt = { $gte: new Date(from), [inclusive ? '$lte' : '$lt']: new Date(to) };
  return SensorLog.aggregate([
    ...minutePipeline({ driverId, createdAt }),
    { $sort: { minute: 1 } },
  ]).allowDiskUse(true);
}

/**
 * A driver's minute rows for readings in [from, to], oldest first. Whole minutes that are already
 * summarised come from sensor_minutes; the partial first minute and the not-yet-summarised end
 * come from SensorLog.
 */
async function minutesBetween(driverId, from, to) {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const state = await RollupState.findById(STATE_ID).lean();
  const rolledUntil = state && state.until ? state.until.getTime() : 0;
  const a = Math.ceil(fromMs / MINUTE) * MINUTE; // first whole minute
  const b = Math.min(rolledUntil, floorMinute(toMs)); // end of summarised whole minutes
  if (a >= b) return rawMinutes(driverId, fromMs, toMs, true);

  const [head, middle, tail] = await Promise.all([
    a > fromMs ? rawMinutes(driverId, fromMs, a) : [],
    SensorMinute.find({ driverId, minute: { $gte: new Date(a), $lt: new Date(b) } })
      .sort({ minute: 1 })
      .lean(),
    rawMinutes(driverId, b, toMs, true),
  ]);
  return [...head, ...middle, ...tail];
}

/** Run rollUp every minute (unref'd so it never keeps the process alive). Returns a stopper. */
function schedule(everyMs = MINUTE) {
  const tick = () =>
    rollUp().catch((err) => logger.warn({ err: err.message }, 'sensor minute rollup failed'));
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

module.exports = { rollUp, minutesBetween, minutePipeline, schedule, MINUTE };
