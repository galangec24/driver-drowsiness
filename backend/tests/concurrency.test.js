/**
 * Many calls at once: concurrent ingest from many cars, two readings of one driver arriving
 * together, the driver cache, the face-recognition queue, and the per-minute history summaries
 * (sensor_minutes) + reporting views.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const Alert = require('../src/models/Alert');
const Driver = require('../src/models/Driver');
const SensorLog = require('../src/models/SensorLog');
const SensorMinute = require('../src/models/SensorMinute');
const User = require('../src/models/User');
const driverCache = require('../src/services/driverCache');
const faceQueue = require('../src/services/faceQueue');
const sensorRollup = require('../src/services/sensorRollup');
const { ensureViews } = require('../src/config/dbViews');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  DROWSY_SIGNALS,
  WARNING_SIGNALS,
} = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ingest = (body) =>
  request(stack.app).post('/api/ingest').set('x-api-key', API_KEY).send(body);

describe('concurrent ingest', () => {
  test('200 readings from 20 cars at once: all answered and stored', async () => {
    const parent = await registerParent(stack.app);
    const drivers = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createDriver(parent.user.id, {}, `Load ${i}`)),
    );
    // Real HTTP to the running server (supertest would start a server per request).
    const calls = drivers.flatMap((d) =>
      Array.from({ length: 10 }, async () => {
        const t = Date.now();
        const res = await fetch(`${stack.url}/api/ingest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
          body: JSON.stringify(ingestPayload(d._id)),
        });
        await res.arrayBuffer();
        return { res, ms: Date.now() - t };
      }),
    );
    const results = await Promise.all(calls);

    expect(results.every((r) => r.res.status === 200)).toBe(true);
    expect(await SensorLog.countDocuments()).toBe(200);
    const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    // A smoke bound only (all 200 sent in the same instant, on a shared test machine): the
    // steady-state latency figures come from scripts/loadTest.js.
    expect(p95).toBeLessThan(10000);
  });

  test('two readings of one driver arriving together make one alert, "detected again"', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    // drowsy and warning have separate cooldowns but are the same alert group (fatigue).
    const [a, b] = await Promise.all([
      ingest(ingestPayload(driver._id, DROWSY_SIGNALS)),
      ingest(ingestPayload(driver._id, WARNING_SIGNALS)),
    ]);
    expect(a.body.alertTriggered && b.body.alertTriggered).toBe(true);
    const alerts = await Alert.find({ driverId: driver._id });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].repeatCount).toBe(2);
    expect(a.body.alertId).toBe(b.body.alertId);
  });
});

describe('driver cache', () => {
  test('shares one lookup, keeps it across location writes, drops it when the driver changes', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const [first, second] = await Promise.all([
      driverCache.get(driver._id),
      driverCache.get(driver._id),
    ]);
    expect(first).toBe(second);

    await Driver.updateOne({ _id: driver._id }, { lastLocation: { lat: 14.5, lng: 121 } });
    expect(await driverCache.get(driver._id)).toBe(first);

    await Driver.updateOne({ _id: driver._id }, { 'personalThresholds.earThreshold': 0.3 });
    const fresh = await driverCache.get(driver._id);
    expect(fresh).not.toBe(first);
    expect(fresh.personalThresholds.earThreshold).toBe(0.3);

    fresh.name = 'Renamed';
    await fresh.save();
    expect((await driverCache.get(driver._id)).name).toBe('Renamed');
  });

  test('a deleted driver is not served from the cache', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    await ingest(ingestPayload(driver._id)).expect(200);
    const doc = await Driver.findById(driver._id);
    await doc.deleteOne();
    await ingest(ingestPayload(driver._id)).expect(404);
  });
});

describe('face recognition queue', () => {
  test('runs one at a time, queues 8, then answers busy (503 FACE_BUSY)', async () => {
    let running = 0;
    let peak = 0;
    const releases = [];
    const job = () =>
      new Promise((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        releases.push(() => {
          running -= 1;
          resolve('done');
        });
      });
    const accepted = Array.from({ length: 9 }, () => faceQueue.run(job));
    await expect(faceQueue.run(job)).rejects.toMatchObject({
      status: 503,
      details: { code: 'FACE_BUSY', retryAfterS: 2 },
    });
    expect(faceQueue.stats()).toMatchObject({ active: 1, waiting: 8 });
    // Finish them one by one: each finished job lets exactly one more start.
    for (let i = 0; i < 9; i += 1) {
      await new Promise((r) => setImmediate(r));
      releases.shift()();
    }
    await expect(Promise.all(accepted)).resolves.toHaveLength(9);
    expect(peak).toBe(1);
  });
});

describe('per-minute summaries (sensor_minutes) and reporting views', () => {
  async function seed() {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const t0 = Math.floor(Date.now() / 60e3) * 60e3 - 30 * 60e3; // 30 min ago, on a boundary
    const at = (min, sec) => new Date(t0 + min * 60e3 + sec * 1000);
    const rows = [];
    for (let min = 0; min < 20; min += 1) {
      for (const sec of [5, 25, 45]) {
        const drowsy = min % 7 === 3 && sec === 25;
        rows.push({
          driverId: driver._id,
          signals: { ear: 0.2 + min / 100, perclos: 0.1, heartRate: 60 + sec / 5 },
          classification: drowsy ? 'drowsy' : 'alert',
          fusionScore: drowsy ? 0.8 : 0.2,
          source: 'driver_monitor',
          createdAt: at(min, sec),
          ...(sec !== 45 && { location: { lat: 14.5 + min / 100, lng: 121 } }),
        });
      }
    }
    await SensorLog.insertMany(rows);
    return { parent, driver, t0 };
  }

  const history = (parent, driver, query = '') =>
    request(stack.app)
      .get(`/api/drivers/${driver._id}/history${query}`)
      .set(auth(parent.token))
      .expect(200)
      .then((r) => r.body);

  test('history is identical before and after the rollup, and the rollup is idempotent', async () => {
    const { parent, driver, t0 } = await seed();
    // An uneven window: starts mid-minute, so the first minute must come from raw readings.
    const query = `?from=${new Date(t0 + 2 * 60e3 + 20e3).toISOString()}&to=${new Date(t0 + 25 * 60e3).toISOString()}`;
    const before = await history(parent, driver, query);

    await sensorRollup.rollUp();
    expect(await SensorMinute.countDocuments({ driverId: driver._id })).toBe(20);
    const after = await history(parent, driver, query);
    expect(after.rows).toEqual(before.rows);
    expect(after.totalKm).toBe(before.totalKm);

    await sensorRollup.rollUp();
    expect(await SensorMinute.countDocuments({ driverId: driver._id })).toBe(20);
    expect((await history(parent, driver, query)).rows).toEqual(before.rows);
  });

  test('admin daily report reads the views', async () => {
    const { parent, driver } = await seed();
    await Alert.create({
      driverId: driver._id,
      parentId: driver.parentId,
      type: 'drowsy',
      confidence: 0.9,
      feedback: { falseAlarm: true, by: 'web', at: new Date() },
    });
    await sensorRollup.rollUp();
    await ensureViews(mongoose.connection.db);
    await User.updateOne({ _id: parent.user.id }, { role: 'admin' });

    const res = await request(stack.app)
      .get('/api/admin/reports/daily?days=2')
      .set(auth(parent.token))
      .expect(200);
    const total = (k) => res.body.rows.reduce((s, r) => s + r[k], 0);
    expect(total('alerts')).toBe(1);
    expect(total('falseAlarms')).toBe(1);
    expect(total('minutesMonitored')).toBe(20);
    expect(total('drowsyMinutes')).toBe(3); // minutes 3, 10, 17
    expect(res.body.summarisedUntil).not.toBeNull();

    await request(stack.app).get('/api/admin/health').set(auth(parent.token)).expect(200);
  });

  test('deleting a driver removes its summaries too', async () => {
    const { parent, driver } = await seed();
    await sensorRollup.rollUp();
    expect(await SensorMinute.countDocuments({ driverId: driver._id })).toBe(20);
    await request(stack.app)
      .delete(`/api/drivers/${driver._id}`)
      .set(auth(parent.token))
      .send({ confirmName: driver.name })
      .expect(204);
    expect(await SensorMinute.countDocuments({ driverId: driver._id })).toBe(0);
  });
});
