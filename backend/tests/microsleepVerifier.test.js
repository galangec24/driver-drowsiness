/**
 * Field test 2026-11-03: a real 3 s microsleep after normal driving reached the server as
 * "drowsy" but the false-alarm verifier scored it 0.03 (threshold 0.96) and no alert was made.
 * A camera-confirmed microsleep (eyes closed >= the driver's limit) now skips the verifier.
 */
const request = require('supertest');
const { env } = require('../src/config/env');
const fpVerifier = require('../src/services/fpVerifier');
const Alert = require('../src/models/Alert');
const { API_KEY, startStack, registerParent, createDriver, ingestPayload } = require('./helpers');

let stack;
const saved = env.fpVerifier;
beforeAll(async () => {
  stack = await startStack();
  env.fpVerifier = true;
  fpVerifier.loadModel();
});
afterAll(async () => {
  env.fpVerifier = saved;
  await stack.stop();
});
beforeEach(async () => stack.reset());

const AWAKE = { ear: 0.3, perclos: 0.02, faceConfidence: 0.95, earBaseline: 0.3, fuzzyScore: 0.15 };
const CLOSED = {
  ear: 0.05,
  perclos: 0.45,
  faceConfidence: 0.95,
  earBaseline: 0.3,
  fuzzyScore: 0.85,
};

/** 35 s of normal driving, then 3 readings with the eyes shut; returns the last response. */
async function drive(closedSignals) {
  const parent = await registerParent(stack.app);
  const driver = await createDriver(parent.user.id, {}, 'Galang');
  const post = (signals, t) =>
    request(stack.app)
      .post('/api/ingest')
      .set('x-api-key', API_KEY)
      .send(ingestPayload(driver._id, signals, { timestamp: new Date(t).toISOString() }))
      .expect(200);
  const t0 = Date.now() - 40_000;
  for (let i = 0; i < 35; i += 1) await post(AWAKE, t0 + i * 1000);
  const responses = [];
  for (let i = 0; i < 3; i += 1) {
    responses.push((await post(closedSignals(i), t0 + 35_000 + i * 1000)).body);
  }
  return { driver, responses };
}

test('the camera saw the eyes shut for 2+ s: microsleep alert, verifier skipped', async () => {
  const { driver, responses } = await drive((i) => ({ ...CLOSED, closedForS: 1 + i }));
  const triggered = responses.filter((r) => r.alertTriggered);
  expect(triggered).toHaveLength(1); // at 2 s; later readings are grouped / in cooldown
  const alert = await Alert.findById(triggered[0].alertId);
  expect(alert.type).toBe('microsleep');
  expect(alert.sensorSnapshot.closedForS).toBeGreaterThanOrEqual(2);
  expect(alert.notifiedAt).toBeInstanceOf(Date); // a microsleep always notifies
  expect(await Alert.countDocuments({ driverId: driver._id })).toBe(1);
});

test('monitors without closedForS: the "eyes closed too long (microsleep)" label counts', async () => {
  const { responses } = await drive(() => ({
    ...CLOSED,
    fatigueReason: 'Drowsy: eyes closed too long (microsleep)',
  }));
  expect(responses.some((r) => r.alertTriggered)).toBe(true);
});

test('a short closure (< 2 s) still goes through the verifier', async () => {
  const { responses } = await drive(() => ({ ...CLOSED, ear: 0.12, closedForS: 0.8 }));
  expect(responses.every((r) => !r.alertTriggered)).toBe(true);
});
