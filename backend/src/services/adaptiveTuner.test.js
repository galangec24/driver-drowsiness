const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Driver = require('../models/Driver');
const SensorLog = require('../models/SensorLog');
const Alert = require('../models/Alert');
const {
  computeEarThreshold,
  computeSensitivity,
  tuneDriver,
  tuneAllDrivers,
  TUNER,
} = require('./adaptiveTuner');

function samples(n, mean, spread = 0.02) {
  // Deterministic spread around the mean.
  return Array.from({ length: n }, (_, i) => mean + spread * Math.sin(i * 1.7));
}

describe('computeEarThreshold (pure)', () => {
  test('returns null with too few samples', () => {
    expect(computeEarThreshold(samples(TUNER.minSamples - 1, 0.3), 0.21)).toBeNull();
  });

  test('moves toward 75% of the driver’s open-eye baseline, smoothed', () => {
    const r = computeEarThreshold(samples(1000, 0.32), 0.21);
    const target = r.baseline * TUNER.closureRatio;
    expect(r.baseline).toBeGreaterThan(0.32);
    expect(r.earThreshold).toBeGreaterThan(0.21);
    expect(r.earThreshold).toBeLessThan(target);
    expect(r.earThreshold).toBeCloseTo(0.21 + TUNER.smoothing * (target - 0.21), 2);
  });

  test('narrow-eyed driver gets a lower threshold than a wide-eyed one', () => {
    const narrow = computeEarThreshold(samples(1000, 0.2), 0.21);
    const wide = computeEarThreshold(samples(1000, 0.36), 0.21);
    expect(narrow.earThreshold).toBeLessThan(0.21);
    expect(wide.earThreshold).toBeGreaterThan(0.21);
  });

  test('robust to eye-closure episodes (uses a high percentile, not the mean)', () => {
    const awake = samples(800, 0.3);
    const withClosures = [...awake, ...new Array(200).fill(0.05)];
    const a = computeEarThreshold(awake, 0.21);
    const b = computeEarThreshold(withClosures, 0.21);
    expect(Math.abs(a.earThreshold - b.earThreshold)).toBeLessThan(0.01);
  });

  test('clamps to sane bounds and ignores junk values', () => {
    const r = computeEarThreshold([...samples(500, 0.9), NaN, -1, 'x', null], 0.21);
    const bounded = 0.21 + TUNER.smoothing * (TUNER.maxEar - 0.21);
    expect(r.earThreshold).toBeCloseTo(bounded, 3);
    expect(r.samples).toBe(500);
  });
});

describe('tuneDriver / tuneAllDrivers (MongoDB)', () => {
  let mongod;
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  test('updates earThreshold from the last 7 days only', async () => {
    const parentId = new mongoose.Types.ObjectId();
    const driver = await Driver.create({ parentId, name: 'Sam' });
    const skipped = await Driver.create({ parentId, name: 'New' });
    const now = new Date();
    const recent = samples(400, 0.34).map((ear) => ({
      driverId: driver._id,
      signals: { ear },
      classification: 'alert',
      fusionScore: 0.1,
      source: 'simulated',
      createdAt: new Date(now.getTime() - 3600 * 1000),
    }));
    // Old data with a very different baseline must be ignored.
    const old = samples(2000, 0.15).map((ear) => ({
      driverId: driver._id,
      signals: { ear },
      classification: 'alert',
      fusionScore: 0.1,
      source: 'simulated',
      createdAt: new Date(now.getTime() - 10 * 24 * 3600 * 1000),
    }));
    await SensorLog.insertMany([...recent, ...old]);

    const r = await tuneDriver(driver, now);
    expect(r.skipped).toBe(false);
    expect(r.samples).toBe(400);
    const saved = await Driver.findById(driver._id);
    expect(saved.personalThresholds.earThreshold).toBeGreaterThan(0.21);
    expect(saved.lastTunedAt).toEqual(now);

    const all = await tuneAllDrivers(now);
    expect(all.find((x) => x.driverId === skipped._id.toString()).skipped).toBe(true);
  });

  test('parent "False alarm" taps make that driver need more evidence; real alarms restore it', async () => {
    const parentId = new mongoose.Types.ObjectId();
    const driver = await Driver.create({ parentId, name: 'Kim' });
    const mk = (falseAlarm) => ({
      driverId: driver._id,
      parentId,
      type: 'drowsy',
      confidence: 0.8,
      feedback: { falseAlarm, by: 'web', at: new Date() },
    });
    await Alert.insertMany([mk(true), mk(true), mk(true), mk(false)]);
    await tuneDriver(driver);
    let saved = await Driver.findById(driver._id);
    expect(saved.personalThresholds.perclosThreshold).toBeCloseTo(0.45);
    expect(saved.personalThresholds.drowsyDurationMs).toBe(2250);
    expect(saved.tuning).toMatchObject({ mode: 'reduced', falseAlarms: 3, realAlarms: 1 });
    expect(saved.toPublic().tuning.mode).toBe('reduced');

    // Later the alerts turn out real: steps back toward the defaults.
    await Alert.updateMany({ driverId: driver._id }, { 'feedback.falseAlarm': false });
    await tuneDriver(saved);
    saved = await Driver.findById(driver._id);
    expect(saved.personalThresholds.perclosThreshold).toBeCloseTo(0.4);
    expect(saved.tuning.mode).toBe('standard');
  });
});

describe('computeSensitivity (pure)', () => {
  const defaults = { perclosThreshold: 0.4, drowsyDurationMs: 2000, yawnThreshold: 3 };

  test('learning until a few alerts have feedback', () => {
    const r = computeSensitivity({ falseAlarms: 1, real: 1 }, defaults);
    expect(r.mode).toBe('learning');
    expect(r.values).toEqual(defaults);
  });

  test('never relaxes beyond the safe maximum, never below the defaults', () => {
    let t = defaults;
    for (let i = 0; i < 20; i += 1) t = computeSensitivity({ falseAlarms: 9, real: 1 }, t).values;
    expect(t).toEqual({ perclosThreshold: 0.6, drowsyDurationMs: 3500, yawnThreshold: 6 });
    for (let i = 0; i < 20; i += 1) t = computeSensitivity({ falseAlarms: 0, real: 10 }, t).values;
    expect(t).toEqual(defaults);
  });

  test('a mixed record keeps the current values', () => {
    const current = { perclosThreshold: 0.5, drowsyDurationMs: 2500, yawnThreshold: 4 };
    const r = computeSensitivity({ falseAlarms: 2, real: 3 }, current);
    expect(r.values).toEqual(current);
    expect(r.mode).toBe('reduced');
    expect(r.falseAlarmRate).toBe(0.4);
  });
});
