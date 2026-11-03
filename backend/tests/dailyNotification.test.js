/**
 * One notification per driver per day: later detections the same day go into today's alert
 * ("detected again ×N") or arrive silently; a microsleep always notifies.
 */
const request = require('supertest');
const Alert = require('../src/models/Alert');
const alertDispatcher = require('../src/services/alertDispatcher');
const ingestService = require('../src/services/ingestService');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  DROWSY_SIGNALS,
  WARNING_SIGNALS,
} = require('./helpers');

const PLAIN_DROWSY = { ear: 0.11, perclos: 0.6, heartRate: 48 }; // drowsy, not a microsleep
const MICROSLEEP = DROWSY_SIGNALS; // eyes far below the threshold + high PERCLOS

let stack;
let newAlerts;
let repeats;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => {
  await stack.reset();
  newAlerts = jest.spyOn(alertDispatcher, 'dispatchNewAlert');
  repeats = jest.spyOn(alertDispatcher, 'dispatchAlertRepeated');
});
afterEach(() => jest.restoreAllMocks());

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ingest = (driver, signals) =>
  request(stack.app)
    .post('/api/ingest')
    .set('x-api-key', API_KEY)
    .send(ingestPayload(driver._id, signals))
    .expect(200)
    .then((r) => r.body);
// Readings later the same day: the per-type cooldowns would otherwise hold them back.
const later = () => ingestService.resetCooldowns();
const notifications = () =>
  newAlerts.mock.calls.filter(([a]) => !a.silent).length +
  repeats.mock.calls.filter(([, , notify]) => notify).length;

async function setup() {
  const parent = await registerParent(stack.app);
  const driver = await createDriver(parent.user.id, {}, 'Galang');
  return { parent, driver };
}

describe('one notification per driver per day', () => {
  test('a second drowsy spell hours later is "detected again", not a new notification', async () => {
    const { driver } = await setup();
    const first = await ingest(driver, PLAIN_DROWSY);
    expect(notifications()).toBe(1);
    // Two hours later (beyond the old 10-minute grouping), still unacknowledged.
    await Alert.updateOne(
      { _id: first.alertId },
      { lastDetectedAt: new Date(Date.now() - 2 * 3600e3) },
    );
    later();
    const second = await ingest(driver, PLAIN_DROWSY);
    expect(second.alertId).toBe(first.alertId);
    expect((await Alert.findById(first.alertId)).repeatCount).toBe(2);
    expect(notifications()).toBe(1);
  });

  test('after the parent acknowledged, a new alert the same day is listed silently', async () => {
    const { parent, driver } = await setup();
    const first = await ingest(driver, PLAIN_DROWSY);
    await request(stack.app)
      .patch(`/api/alerts/${first.alertId}/ack`)
      .set(auth(parent.token))
      .send({ acknowledgedBy: 'web' })
      .expect(200);
    later();
    const second = await ingest(driver, PLAIN_DROWSY);
    expect(second.alertId).not.toBe(first.alertId);
    expect(newAlerts).toHaveBeenCalledTimes(2);
    expect(newAlerts.mock.calls[1][0].silent).toBe(true);
    expect(notifications()).toBe(1);
    expect((await Alert.findById(second.alertId)).notifiedAt).toBeUndefined();
  });

  test('other kinds of alert the same day are silent too (warning, distraction)', async () => {
    const { driver } = await setup();
    await ingest(driver, PLAIN_DROWSY);
    later();
    await ingest(driver, { ear: 0.3, perclos: 0.05, heartRate: 72, distractionCount: 5 });
    expect(newAlerts).toHaveBeenCalledTimes(2);
    expect(notifications()).toBe(1);
  });

  test('a microsleep always notifies, even after today’s notification', async () => {
    const { driver } = await setup();
    await ingest(driver, WARNING_SIGNALS); // the day's notification
    later();
    const res = await ingest(driver, MICROSLEEP); // escalates the open alert to microsleep
    expect(res.alertTriggered).toBe(true);
    expect(notifications()).toBe(2);
    const alert = await Alert.findById(res.alertId);
    expect(alert.type).toBe('microsleep');
    expect(alert.notifiedAt).toBeInstanceOf(Date);
  });

  test('a microsleep again within 10 minutes is quiet; later it notifies again', async () => {
    const { driver } = await setup();
    const first = await ingest(driver, MICROSLEEP);
    expect(notifications()).toBe(1);
    later();
    await ingest(driver, MICROSLEEP); // same episode: grouped, no second notification
    expect(notifications()).toBe(1);
    await Alert.updateOne(
      { _id: first.alertId },
      { notifiedAt: new Date(Date.now() - 11 * 60 * 1000) },
    );
    later();
    const third = await ingest(driver, MICROSLEEP);
    expect(third.alertId).toBe(first.alertId); // still the same alert, "detected again ×3"
    expect(notifications()).toBe(2); // but the parent is told again
  });

  test('each driver has their own daily notification', async () => {
    const parent = await registerParent(stack.app);
    const a = await createDriver(parent.user.id, {}, 'Ana');
    const b = await createDriver(parent.user.id, {}, 'Ben');
    await ingest(a, PLAIN_DROWSY);
    await ingest(b, PLAIN_DROWSY);
    expect(notifications()).toBe(2);
  });
});
