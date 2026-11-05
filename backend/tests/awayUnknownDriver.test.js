/**
 * The driver gets out (gas station, takeout): "Away from the car" instead of "Offline". Someone who
 * isn't a registered driver at the wheel for a while: an "Unrecognized driver" alert that always
 * notifies (at most every 10 minutes per car), with the camera photo.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const Alert = require('../src/models/Alert');
const media = require('../src/services/mediaStorage');
const alertDispatcher = require('../src/services/alertDispatcher');
const statusStore = require('../src/services/statusStore');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  connectSocket,
  fixtureBase64,
} = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(path.join(media.UPLOAD_DIR, 'alerts'), { recursive: true, force: true });
});

const device = (route, body) =>
  request(stack.app).post(`/api/ingest${route}`).set('x-api-key', API_KEY).send(body);
const PHOTO = fixtureBase64('personA_front.jpg');

describe('driver out of the car', () => {
  test('"away" updates the live status, and the family sees it at once', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id, {}, 'Galang');
    await device('', ingestPayload(driver._id)).expect(200); // was driving
    const sock = await connectSocket(stack.url, parent.token);
    // On connecting, the current status ("alert") is sent first: wait for the "away" update.
    const seen = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no away status')), 3000);
      sock.on('driver:status', (st) => {
        if (st.status === 'away') {
          clearTimeout(timer);
          resolve(st);
        }
      });
    });
    await device('/away', { driverId: driver._id.toString() }).expect(200);
    const status = await seen;
    sock.close();
    expect(status).toMatchObject({ driverId: driver._id.toString(), status: 'away' });
    expect(statusStore.get(driver._id.toString()).status).toBe('away');
  });

  test('needs the device key and a real driver', async () => {
    await request(stack.app)
      .post('/api/ingest/away')
      .send({ driverId: 'a'.repeat(24) })
      .expect(401);
    await device('/away', { driverId: 'a'.repeat(24) }).expect(404);
  });
});

describe('unrecognised driver at the wheel', () => {
  test('alerts the family on the car’s last driver, with the photo, and always notifies', async () => {
    const parent = await registerParent(stack.app);
    await createDriver(parent.user.id, {}, 'Ana');
    const galang = await createDriver(parent.user.id, {}, 'Galang');
    await device('', ingestPayload(galang._id, { ear: 0.11, perclos: 0.6, heartRate: 48 })); // today's notification
    const newAlerts = jest.spyOn(alertDispatcher, 'dispatchNewAlert');

    const res = await device('/unknown-driver', {
      family: parent.user.email,
      image: PHOTO,
      lastDriverId: galang._id.toString(),
    }).expect(201);
    const alert = await Alert.findById(res.body.alertId);
    expect(alert.type).toBe('face_match');
    expect(alert.driverId.toString()).toBe(galang._id.toString());
    expect(alert.snapshotUrl).toMatch(/alerts/);
    expect(alert.notifiedAt).toBeInstanceOf(Date); // not silenced by the daily limit
    expect(newAlerts.mock.calls[0][0].silent).toBeUndefined();

    // A second report within 10 minutes: no new alert.
    const again = await device('/unknown-driver', { family: parent.user.email, image: PHOTO });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ alertId: null, reason: 'cooldown' });
    expect(await Alert.countDocuments({ type: 'face_match' })).toBe(1);
  });

  test('without a last driver, the family’s most recently active driver is used', async () => {
    const parent = await registerParent(stack.app);
    await createDriver(parent.user.id, {}, 'Ana');
    const ben = await createDriver(parent.user.id, {}, 'Ben');
    await device('', ingestPayload(ben._id)).expect(200);
    const res = await device('/unknown-driver', { family: parent.user.email, image: PHOTO }).expect(
      201,
    );
    expect(res.body.driverId).toBe(ben._id.toString());
  });

  test('a wrong FAMILY_EMAIL or a family without drivers is refused', async () => {
    await device('/unknown-driver', { family: 'nobody@example.com', image: PHOTO }).expect(404);
    const parent = await registerParent(stack.app);
    await device('/unknown-driver', { family: parent.user.email, image: PHOTO }).expect(409);
  });
});
