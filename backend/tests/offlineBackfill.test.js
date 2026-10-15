const request = require('supertest');
const Alert = require('../src/models/Alert');
const statusStore = require('../src/services/statusStore');
const { resolveTimestamp } = require('../src/services/ingestService');
const { API_KEY, startStack, registerParent, createDriver, ingestPayload } = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

const DROWSY = { ear: 0.08, perclos: 0.85, heartRate: 50 };
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ingest = (body) =>
  request(stack.app).post('/api/ingest').set('x-api-key', API_KEY).send(body);

describe('store-and-forward: readings recorded offline and sent later', () => {
  test('keeps the original time and marks the alert as delayed', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const recorded = ago(20 * 60 * 1000);

    const res = await ingest(
      ingestPayload(driver._id, DROWSY, { timestamp: recorded, queued: true }),
    ).expect(200);
    expect(res.body.alertTriggered).toBe(true);

    const alert = await Alert.findById(res.body.alertId);
    expect(alert.sensorSnapshot.timestamp.toISOString()).toBe(recorded);
    expect(alert.delayedS).toBeGreaterThanOrEqual(20 * 60 - 5);
    expect(alert.toPublic().delayedS).toBe(alert.delayedS);
  });

  test('live readings are not delayed; a late reading never replaces the newer live status', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const live = await ingest(ingestPayload(driver._id, DROWSY)).expect(200);
    expect((await Alert.findById(live.body.alertId)).delayedS).toBeUndefined();
    const liveUpdate = statusStore.get(driver._id.toString()).lastUpdate;

    await ingest(
      ingestPayload(
        driver._id,
        { ear: 0.3, perclos: 0.02 },
        { timestamp: ago(10 * 60 * 1000), queued: true },
      ),
    ).expect(200);
    expect(statusStore.get(driver._id.toString()).lastUpdate).toBe(liveUpdate);
  });

  test('each episode in the backlog gets its own alert; duplicates within the cooldown do not', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    for (const t of [30 * 60 * 1000, 30 * 60 * 1000 - 1000, 20 * 60 * 1000]) {
      await ingest(ingestPayload(driver._id, DROWSY, { timestamp: ago(t), queued: true })).expect(
        200,
      );
    }
    // 30 min ago (+ 1 s later, inside the cooldown) and 20 min ago → two alerts
    expect(await Alert.countDocuments({ driverId: driver._id })).toBe(2);
  });

  test('timestamp rules: live readings allow 5 min of clock skew, queued ones up to 24 h', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    const iso = (ms) => new Date(now - ms).toISOString();
    expect(resolveTimestamp(iso(60 * 60 * 1000), now).getTime()).toBe(now); // live, 1 h old → now
    expect(resolveTimestamp(iso(60 * 60 * 1000), now, true).toISOString()).toBe(
      iso(60 * 60 * 1000),
    );
    expect(resolveTimestamp(iso(25 * 60 * 60 * 1000), now, true).getTime()).toBe(now); // too old
    expect(resolveTimestamp(iso(-10 * 60 * 1000), now, true).getTime()).toBe(now); // future clock
  });
});
