const request = require('supertest');
const Alert = require('../src/models/Alert');
const SensorLog = require('../src/models/SensorLog');
const { computeDrowsinessScore, DEFAULT_THRESHOLDS } = require('../src/services/fusionEngine');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  connectSocket,
  waitForEvent,
} = require('./helpers');

const driver = { personalThresholds: { ...DEFAULT_THRESHOLDS } };
const AWAKE = { ear: 0.3, perclos: 0.05, faceConfidence: 0.95 };

describe('fusion with wearable + yawning (docs/WEARABLE.md)', () => {
  test('without the new signals the score is exactly the original formula', () => {
    const s = { ear: 0.15, perclos: 0.3, heartRate: 55 };
    const original = 0.6 * (0.6 * ((0.21 - 0.15) / 0.21) + 0.4 * (0.3 / 0.4)) + 0.4 * (5 / 15);
    expect(computeDrowsinessScore(s, driver).fusionScore).toBeCloseTo(original, 10);
  });

  test('a heart-rate drop below the personal baseline counts even above 60 bpm', () => {
    const base = computeDrowsinessScore({ ...AWAKE, heartRate: 66 }, driver);
    expect(base.components.physioScore).toBe(0);
    // 78 → 66 bpm = 15.4 % drop ≥ hrDropThreshold 15 % → full HR evidence
    const dropped = computeDrowsinessScore({ ...AWAKE, heartRate: 66, hrBaseline: 78 }, driver);
    expect(dropped.components.physioScore).toBe(1);
    // with HRV unchanged the HRV part adds nothing: 0.7·1 + 0.3·0
    const withHrv = computeDrowsinessScore(
      { ...AWAKE, heartRate: 66, hrBaseline: 78, hrv: 40, hrvBaseline: 40 },
      driver,
    );
    expect(withHrv.components.physioScore).toBeCloseTo(0.7, 10);
    // HRV +50 % on top → full
    const hrvUp = computeDrowsinessScore(
      { ...AWAKE, heartRate: 66, hrBaseline: 78, hrv: 60, hrvBaseline: 40 },
      driver,
    );
    expect(hrvUp.components.physioScore).toBeCloseTo(1, 10);
  });

  test('frequent yawning alone raises a warning; occasional yawns only add evidence', () => {
    const one = computeDrowsinessScore({ ...AWAKE, yawnCount: 1 }, driver);
    expect(one.classification).toBe('alert');
    expect(one.components.yawnScore).toBeCloseTo(1 / 3, 10);
    const three = computeDrowsinessScore({ ...AWAKE, yawnCount: 3 }, driver);
    expect(three.classification).toBe('warning');
    expect(three.components.yawnEscalated).toBe(true);
  });

  test('yawning + heavy eyelids + HR drop combine to drowsy', () => {
    const r = computeDrowsinessScore(
      { ear: 0.16, perclos: 0.3, heartRate: 64, hrBaseline: 76, yawnCount: 3 },
      driver,
    );
    expect(r.classification).toBe('drowsy');
    expect(r.components.yawnEscalated).toBe(false);
  });
});

describe('ingest with wearable + yawn signals', () => {
  let stack;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => stack.stop());
  beforeEach(async () => stack.reset());

  const post = (body) => request(stack.app).post('/api/ingest').set('x-api-key', API_KEY).send(body);

  test('yawning raises one "yawning" alert (no verifier, 5-minute cooldown) and is logged', async () => {
    const parent = await registerParent(stack.app);
    const d = await createDriver(parent.user.id);
    const socket = await connectSocket(stack.url, parent.token);
    try {
      const status = waitForEvent(socket, 'driver:status');
      const body = ingestPayload(d._id, { heartRate: 70, yawnCount: 3, mar: 0.72, hrv: 41, hrBaseline: 74 }, {
        wearable: { connected: true, contact: true, battery: 81, name: 'GuardianWatch' },
      });
      const first = await post(body).expect(200);
      expect(first.body.classification).toBe('warning');
      expect(first.body.alertTriggered).toBe(true);
      const live = await status;
      expect(live.signals).toMatchObject({ yawnCount: 3, hrv: 41 });
      expect(live.wearable).toMatchObject({ connected: true, battery: 81 });

      const second = await post(body).expect(200);
      expect(second.body.alertTriggered).toBe(false);

      const alerts = await Alert.find({ driverId: d._id });
      expect(alerts.map((a) => a.type)).toEqual(['yawning']);
      expect(alerts[0].sensorSnapshot.yawnCount).toBe(3);
      const log = await SensorLog.findOne({ driverId: d._id });
      expect(log.signals).toMatchObject({ yawnCount: 3, mar: 0.72, hrv: 41, hrBaseline: 74 });
    } finally {
      socket.close();
    }
  });

  test('invalid wearable values are rejected', async () => {
    const parent = await registerParent(stack.app);
    const d = await createDriver(parent.user.id);
    await post(ingestPayload(d._id, { yawnCount: -1 })).expect(400);
    await post(ingestPayload(d._id, { yawnCount: 1.5 })).expect(400);
    await post(ingestPayload(d._id, {}, { wearable: { connected: 'yes' } })).expect(400);
  });

  test('the device can fetch personal thresholds with the ingest key only', async () => {
    const parent = await registerParent(stack.app);
    const d = await createDriver(parent.user.id, { drowsyDurationMs: 1500, yawnThreshold: 4 });
    const url = `/api/ingest/drivers/${d._id}/thresholds`;
    const res = await request(stack.app).get(url).set('x-api-key', API_KEY).expect(200);
    expect(res.body.personalThresholds).toMatchObject({
      drowsyDurationMs: 1500,
      yawnThreshold: 4,
      hrDropThreshold: 0.15,
    });
    await request(stack.app).get(url).expect(401);
    await request(stack.app).get(url).set('x-api-key', 'wrong').expect(401);
    await request(stack.app)
      .get('/api/ingest/drivers/665f00000000000000000099/thresholds')
      .set('x-api-key', API_KEY)
      .expect(404);
  });

  test('parents can tune the new thresholds', async () => {
    const parent = await registerParent(stack.app);
    const d = await createDriver(parent.user.id);
    const res = await request(stack.app)
      .patch(`/api/drivers/${d._id}/thresholds`)
      .set('Authorization', `Bearer ${parent.token}`)
      .send({ yawnThreshold: 5, fusionWeightYawn: 0.3, hrDropThreshold: 0.1 })
      .expect(200);
    expect(res.body.driver.personalThresholds).toMatchObject({ yawnThreshold: 5, hrDropThreshold: 0.1 });
    await request(stack.app)
      .patch(`/api/drivers/${d._id}/thresholds`)
      .set('Authorization', `Bearer ${parent.token}`)
      .send({ yawnThreshold: 0 })
      .expect(400);
  });
});

describe('dashboard radar: breathing rate', () => {
  test('a breathing slow-down below the personal baseline adds physiological evidence', () => {
    const awake = computeDrowsinessScore({ ...AWAKE, breathingRate: 16, breathingBaseline: 16 }, driver);
    expect(awake.components.physioScore).toBe(0);
    // radar only (no HR baseline yet): 16 → 12.8 = −20 % = full breathing evidence
    const slow = computeDrowsinessScore({ ...AWAKE, breathingRate: 12.8, breathingBaseline: 16 }, driver);
    expect(slow.components.physioScore).toBeCloseTo(1, 10);
    // HR drop full + breathing half → (0.7·1 + 0.4·0.5) / 1.1
    const both = computeDrowsinessScore(
      { ...AWAKE, heartRate: 66, hrBaseline: 78, breathingRate: 14.4, breathingBaseline: 16 },
      driver,
    );
    expect(both.components.physioScore).toBeCloseTo(0.9 / 1.1, 10);
  });

  test('breathing and radar status reach the log and the live status', async () => {
    const stack = await startStack();
    try {
      const parent = await registerParent(stack.app);
      const d = await createDriver(parent.user.id);
      const socket = await connectSocket(stack.url, parent.token);
      const status = waitForEvent(socket, 'driver:status');
      await request(stack.app)
        .post('/api/ingest')
        .set('x-api-key', API_KEY)
        .send(
          ingestPayload(d._id, { heartRate: 68, breathingRate: 13.5, breathingBaseline: 15 }, {
            radar: { connected: true, present: true, distanceCm: 84 },
          }),
        )
        .expect(200);
      const live = await status;
      socket.close();
      expect(live.signals).toMatchObject({ breathingRate: 13.5, breathingBaseline: 15 });
      expect(live.radar).toEqual({ connected: true, present: true, distanceCm: 84 });
      const log = await SensorLog.findOne({ driverId: d._id });
      expect(log.signals.breathingRate).toBe(13.5);
    } finally {
      await stack.stop();
    }
  });
});

describe('head nodding', () => {
  test('one nod adds evidence; reaching nodThreshold means drowsy', () => {
    const one = computeDrowsinessScore({ ...AWAKE, nodCount: 1 }, driver);
    expect(one.classification).toBe('alert');
    expect(one.components.nodScore).toBe(0.5);
    const two = computeDrowsinessScore({ ...AWAKE, nodCount: 2 }, driver);
    expect(two.classification).toBe('drowsy');
    expect(two.components.nodEscalated).toBe(true);
    // heavy eyelids alone = warning (0.57); one nod on top (+0.15) tips the score itself to drowsy
    expect(computeDrowsinessScore({ ear: 0.02, perclos: 0.5 }, driver).classification).toBe('warning');
    const combo = computeDrowsinessScore({ ear: 0.02, perclos: 0.5, nodCount: 1 }, driver);
    expect(combo.classification).toBe('drowsy');
    expect(combo.components.nodEscalated).toBe(false);
  });

  test('nodding raises a "nodding" alert without the verifier, 1-minute cooldown', async () => {
    const stack = await startStack();
    try {
      const parent = await registerParent(stack.app);
      const d = await createDriver(parent.user.id);
      const send = () =>
        request(stack.app)
          .post('/api/ingest')
          .set('x-api-key', API_KEY)
          .send(ingestPayload(d._id, { nodCount: 2, yawnCount: 3 }));
      const first = await send().expect(200);
      expect(first.body).toMatchObject({ classification: 'drowsy', alertTriggered: true });
      expect((await send().expect(200)).body.alertTriggered).toBe(false);
      const alerts = await Alert.find({ driverId: d._id });
      expect(alerts.map((a) => a.type)).toEqual(['nodding']);
      expect(alerts[0].sensorSnapshot.nodCount).toBe(2);
    } finally {
      await stack.stop();
    }
  });
});
