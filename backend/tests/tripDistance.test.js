/**
 * "How far had the driver gone when the first alert came?": the first alert of a drive carries the
 * distance and time since the driver was first detected (services/tripTracker.js).
 */
const request = require('supertest');
const Alert = require('../src/models/Alert');
const { API_KEY, startStack, registerParent, createDriver, ingestPayload } = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());
afterEach(() => jest.restoreAllMocks());

const ingest = (body) =>
  request(stack.app).post('/api/ingest').set('x-api-key', API_KEY).send(body);

test('the first alert of a drive records the distance and minutes since the drive started', async () => {
  const parent = await registerParent(stack.app);
  const driver = await createDriver(parent.user.id, {}, 'Galang');
  const t0 = Date.now();
  let clock = t0;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  const awake = { ear: 0.3, perclos: 0.05, heartRate: 72 };
  // Driving north ~1.1 km a minute for 4 minutes, awake.
  for (let i = 0; i <= 4; i += 1) {
    clock = t0 + i * 60_000;
    await ingest(
      ingestPayload(driver._id, awake, {
        timestamp: new Date(clock).toISOString(),
        location: { lat: 14.5 + i * 0.01, lng: 121.0, speed: 66, accuracy: 8 },
      }),
    ).expect(200);
  }
  // Then falls asleep at the wheel.
  clock = t0 + 5 * 60_000;
  const res = await ingest(
    ingestPayload(
      driver._id,
      { ear: 0.05, perclos: 0.7, heartRate: 50, closedForS: 3 },
      {
        timestamp: new Date(clock).toISOString(),
        location: { lat: 14.55, lng: 121.0, speed: 60, accuracy: 8 },
      },
    ),
  ).expect(200);
  expect(res.body.alertTriggered).toBe(true);
  const alert = (await Alert.findById(res.body.alertId)).toPublic();
  expect(alert.trip.distanceKm).toBeCloseTo(5.6, 1);
  expect(alert.trip.minutes).toBe(5);
  expect(new Date(alert.trip.startedAt).getTime()).toBe(t0);
  expect(alert.trip.startLocation).toEqual({ lat: 14.5, lng: 121.0 });
});
