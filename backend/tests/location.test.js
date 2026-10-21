const fs = require('fs');
const path = require('path');
const request = require('supertest');
const Alert = require('../src/models/Alert');
const Driver = require('../src/models/Driver');
const SensorLog = require('../src/models/SensorLog');
const { UPLOAD_DIR } = require('../src/services/mediaStorage');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  connectSocket,
  waitForEvent,
  fixtureBase64,
  DROWSY_SIGNALS,
} = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const MAKATI = { lat: 14.5547, lng: 121.0244, heading: 92.5, speed: 61.2, accuracy: 8 };

async function setup() {
  const parent = await registerParent(stack.app);
  const driver = await createDriver(parent.user.id);
  return { parent, driver };
}

const ingest = (body, key = API_KEY) =>
  request(stack.app).post('/api/ingest').set('x-api-key', key).send(body);

describe('ingest location (optional, additive)', () => {
  test('location flows to SensorLog, driver:status, the alert and the driver record', async () => {
    const { parent, driver } = await setup();
    const socket = await connectSocket(stack.url, parent.token);
    try {
      const status = waitForEvent(socket, 'driver:status');
      const res = await ingest(ingestPayload(driver._id, DROWSY_SIGNALS, { location: MAKATI }))
        .expect(200);
      // Contract response is unchanged.
      expect(Object.keys(res.body)).toEqual([
        'classification',
        'fusionScore',
        'alertTriggered',
        'alertId',
      ]);
      expect((await status).location).toMatchObject({ lat: 14.5547, lng: 121.0244, heading: 92.5 });

      const alert = await Alert.findById(res.body.alertId);
      expect(alert.toPublic().location).toMatchObject({ lat: 14.5547, lng: 121.0244, speed: 61.2 });
      const log = await SensorLog.findOne({ driverId: driver._id });
      expect(log.location.lat).toBe(14.5547);

      const detail = await request(stack.app)
        .get(`/api/drivers/${driver._id}`)
        .set(auth(parent.token))
        .expect(200);
      expect(detail.body.driver.lastLocation).toMatchObject({ lat: 14.5547, lng: 121.0244 });
      // Persisted (fire-and-forget) for after a restart.
      await new Promise((r) => setTimeout(r, 100));
      expect((await Driver.findById(driver._id)).lastLocation.lng).toBe(121.0244);
    } finally {
      socket.close();
    }
  });

  test('a tick without GPS keeps the last known fix; payloads without location still work', async () => {
    const { driver } = await setup();
    await ingest(ingestPayload(driver._id, {}, { location: MAKATI })).expect(200);
    const res = await ingest(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);
    const alert = await Alert.findById(res.body.alertId);
    expect(alert.location.lat).toBe(14.5547);

    const { driver: other } = await setup();
    const plain = await ingest(ingestPayload(other._id, DROWSY_SIGNALS)).expect(200);
    expect((await Alert.findById(plain.body.alertId)).toPublic().location).toBeNull();
  });

  test('invalid coordinates are rejected', async () => {
    const { driver } = await setup();
    await ingest(ingestPayload(driver._id, {}, { location: { lat: 95, lng: 10 } })).expect(400);
    await ingest(ingestPayload(driver._id, {}, { location: { lat: 10 } })).expect(400);
  });
});

describe('POST /api/ingest/snapshot', () => {
  afterAll(() => fs.rmSync(path.join(UPLOAD_DIR, 'alerts'), { recursive: true, force: true }));

  async function alertFor(driver) {
    const res = await ingest(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);
    return res.body.alertId;
  }

  const snap = (body, key = API_KEY) =>
    request(stack.app).post('/api/ingest/snapshot').set('x-api-key', key).send(body);

  test('stores the frame, updates the alert and notifies the parent', async () => {
    const { parent, driver } = await setup();
    const alertId = await alertFor(driver);
    const socket = await connectSocket(stack.url, parent.token);
    try {
      const updated = waitForEvent(socket, 'alert:updated');
      const res = await snap({
        driverId: driver._id.toString(),
        alertId,
        image: fixtureBase64('personA_front.jpg'),
      }).expect(201);
      expect(res.body.snapshotUrl).toBe(`/uploads/alerts/${driver._id}/${alertId}.jpg`);
      expect(await updated).toEqual({ alertId, snapshotUrl: res.body.snapshotUrl });

      const list = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
      expect(list.body.alerts[0].snapshotUrl).toBe(res.body.snapshotUrl);
      await request(stack.app).get(res.body.snapshotUrl).expect(200);
    } finally {
      socket.close();
    }
  });

  test('rejects a bad key, a foreign alert, an old alert and non-images', async () => {
    const { driver } = await setup();
    const { driver: other } = await setup();
    const alertId = await alertFor(driver);
    const image = fixtureBase64('personA_front.jpg');
    const body = { driverId: driver._id.toString(), alertId, image };

    await snap(body, 'wrong').expect(401);
    await snap({ ...body, driverId: other._id.toString() }).expect(404);
    await snap({ ...body, image: Buffer.from('x'.repeat(300)).toString('base64') }).expect(415);

    // createdAt is immutable through Mongoose; backdate it on the raw collection.
    await Alert.collection.updateOne(
      { _id: new Alert.base.Types.ObjectId(alertId) },
      { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } },
    );
    await snap(body).expect(409);
  });

  test('deleting the driver deletes their snapshots', async () => {
    const { parent, driver } = await setup();
    const alertId = await alertFor(driver);
    await snap({
      driverId: driver._id.toString(),
      alertId,
      image: fixtureBase64('personA_front.jpg'),
    }).expect(201);
    const dir = path.join(UPLOAD_DIR, 'alerts', driver._id.toString());
    expect(fs.existsSync(dir)).toBe(true);
    await request(stack.app)
      .delete(`/api/drivers/${driver._id}`)
      .set(auth(parent.token))
      .send({ confirmName: driver.name })
      .expect(204);
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe('device clock skew (Raspberry Pi without RTC)', () => {
  const { resolveTimestamp } = require('../src/services/ingestService');

  test('plausible device time is kept; a stale boot clock falls back to server time', () => {
    const now = Date.parse('2026-10-10T08:00:00Z');
    expect(resolveTimestamp('2026-10-10T07:59:58.500Z', now).toISOString()).toBe('2026-10-10T07:59:58.500Z');
    expect(resolveTimestamp('2026-01-01T00:00:00Z', now).getTime()).toBe(now);
    expect(resolveTimestamp(undefined, now).getTime()).toBe(now);
  });

  test('a skewed payload still shows the driver as live', async () => {
    const { parent, driver } = await setup();
    await ingest(ingestPayload(driver._id, {}, { timestamp: '2025-01-01T00:00:00.000Z' })).expect(200);
    const res = await request(stack.app)
      .get(`/api/drivers/${driver._id}`)
      .set(auth(parent.token))
      .expect(200);
    expect(Date.now() - Date.parse(res.body.driver.lastUpdate)).toBeLessThan(10000);
  });
});
