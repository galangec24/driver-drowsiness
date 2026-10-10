const request = require('supertest');
const Alert = require('../src/models/Alert');
const SensorLog = require('../src/models/SensorLog');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  connectSocket,
  waitForEvent,
  DROWSY_SIGNALS,
  WARNING_SIGNALS,
} = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

async function setup(thresholds) {
  const parent = await registerParent(stack.app);
  const driver = await createDriver(parent.user.id, thresholds);
  return { parent, driver };
}

function post(body, key = API_KEY) {
  const req = request(stack.app).post('/api/ingest').send(body);
  return key === null ? req : req.set('x-api-key', key);
}

describe('POST /api/ingest — happy path', () => {
  test('drowsy payload → exact response shape, SensorLog + Alert persisted', async () => {
    const { driver } = await setup();
    const res = await post(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);

    // Frozen contract: exact keys, in order.
    expect(Object.keys(res.body)).toEqual([
      'classification',
      'fusionScore',
      'alertTriggered',
      'alertId',
    ]);
    expect(res.body.classification).toBe('drowsy');
    expect(res.body.fusionScore).toBeGreaterThan(0.7);
    expect(res.body.alertTriggered).toBe(true);
    expect(res.body.alertId).toMatch(/^[a-f0-9]{24}$/);

    const alert = await Alert.findById(res.body.alertId);
    expect(['drowsy', 'microsleep']).toContain(alert.type);
    expect(alert.parentId.toString()).toBe(driver.parentId.toString());
    expect(alert.sensorSnapshot.ear).toBe(DROWSY_SIGNALS.ear);
    expect(await SensorLog.countDocuments({ driverId: driver._id })).toBe(1);
  });

  test('alert classification → SensorLog persisted, no Alert, fusionScore still returned', async () => {
    const { driver } = await setup();
    const res = await post(ingestPayload(driver._id)).expect(200);
    expect(res.body).toEqual({
      classification: 'alert',
      fusionScore: expect.any(Number),
      alertTriggered: false,
      alertId: null,
    });
    expect(await SensorLog.countDocuments({ driverId: driver._id })).toBe(1);
    expect(await Alert.countDocuments()).toBe(0);
  });

  test('warning classification creates a "warning" alert', async () => {
    const { driver } = await setup();
    const res = await post(ingestPayload(driver._id, WARNING_SIGNALS)).expect(200);
    expect(res.body.classification).toBe('warning');
    expect((await Alert.findById(res.body.alertId)).type).toBe('warning');
  });

  test('uses per-driver thresholds: same signals, different drivers, different outcome', async () => {
    const { driver: normal } = await setup();
    const { driver: narrowEyed } = await setup({ earThreshold: 0.12, perclosThreshold: 0.9 });
    // normal → 0.53 (warning); narrow-eyed personal thresholds → 0.24 (alert)
    const signals = { ear: 0.12, perclos: 0.4, heartRate: 55 };
    const a = await post(ingestPayload(normal._id, signals)).expect(200);
    const b = await post(ingestPayload(narrowEyed._id, signals)).expect(200);
    expect(a.body.fusionScore).not.toBe(b.body.fusionScore);
    expect(a.body.classification).toBe('warning');
    expect(b.body.classification).toBe('alert');
  });

  test('accepts every source enum value and additive optional fields', async () => {
    const { driver } = await setup();
    for (const source of ['simulated', 'driver_monitor', 'mobile_app', 'hardware']) {
      await post(
        ingestPayload(driver._id, { steeringVariance: 0.3 }, { source, firmware: '1.0' }),
      ).expect(200);
    }
    expect(await SensorLog.countDocuments({ driverId: driver._id })).toBe(4);
  });

  test('missing signal fields do not crash', async () => {
    const { driver } = await setup();
    const res = await post({
      driverId: driver._id.toString(),
      source: 'hardware',
      signals: {},
    }).expect(200);
    expect(res.body.classification).toBe('alert');
  });

  test('repeated drowsy ticks inside the cooldown create one alert', async () => {
    const { driver } = await setup();
    const first = await post(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);
    const second = await post(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);
    expect(first.body.alertTriggered).toBe(true);
    expect(second.body.alertTriggered).toBe(false);
    expect(second.body.classification).toBe('drowsy');
    expect(await SensorLog.countDocuments({ driverId: driver._id })).toBe(2);
  });

  test('matchedDriver mismatch raises a face_match alert', async () => {
    const { driver } = await setup();
    const other = '0123456789abcdef01234567';
    const res = await post(ingestPayload(driver._id, { matchedDriver: other })).expect(200);
    expect(res.body.alertTriggered).toBe(true);
    expect((await Alert.findById(res.body.alertId)).type).toBe('face_match');
  });
});

describe('POST /api/ingest — rejections', () => {
  test('invalid API key → 401', async () => {
    const { driver } = await setup();
    await post(ingestPayload(driver._id), 'wrong-key').expect(401);
    await post(ingestPayload(driver._id), null).expect(401);
    expect(await SensorLog.countDocuments()).toBe(0);
  });

  test('invalid payload → 400 (validation runs before the key check)', async () => {
    const { driver } = await setup();
    await post({ source: 'simulated', signals: {} }).expect(400);
    await post(ingestPayload(driver._id, {}, { source: 'webcam' })).expect(400);
    await post(ingestPayload('not-an-id')).expect(400);
    await post(ingestPayload(driver._id, { ear: 'closed' })).expect(400);
    await post(ingestPayload(driver._id, {}, { timestamp: 'yesterday' })).expect(400);
    await post({ source: 'simulated' }, 'wrong-key').expect(400);
  });

  test('malformed JSON → 400', async () => {
    await request(stack.app)
      .post('/api/ingest')
      .set('x-api-key', API_KEY)
      .set('Content-Type', 'application/json')
      .send('{"driverId": ')
      .expect(400);
  });

  test('unknown driver → 404', async () => {
    const res = await post(ingestPayload('aaaaaaaaaaaaaaaaaaaaaaaa')).expect(404);
    expect(res.body).toEqual({ error: 'Driver not found' });
  });
});

describe('POST /api/ingest — realtime', () => {
  test('emits alert:new and driver:status to the parent room within the latency budget', async () => {
    const { parent, driver } = await setup();
    const other = await registerParent(stack.app);
    const socket = await connectSocket(stack.url, parent.token);
    const otherSocket = await connectSocket(stack.url, other.token);
    let leaked = false;
    otherSocket.on('alert:new', () => {
      leaked = true;
    });

    const started = Date.now();
    const alertEvt = waitForEvent(socket, 'alert:new');
    const statusEvt = waitForEvent(socket, 'driver:status');
    const res = await post(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);
    const alert = await alertEvt;
    const elapsed = Date.now() - started;

    expect(alert.id).toBe(res.body.alertId);
    expect(alert.driverId).toBe(driver._id.toString());
    expect(alert.driverName).toMatch(/^Test Driver/);
    expect(alert.sensorSnapshot).toMatchObject({ ear: 0.08, perclos: 0.6, heartRate: 48 });
    expect(elapsed).toBeLessThan(500);

    const status = await statusEvt;
    expect(status).toMatchObject({ driverId: driver._id.toString(), status: 'drowsy' });
    expect(status.lastUpdate).toEqual(expect.any(String));

    await new Promise((r) => setTimeout(r, 100));
    expect(leaked).toBe(false);
    socket.close();
    otherSocket.close();
  });
});
