/**
 * TESTING PHASE: monitor links turn a phone's browser into the driver monitor for one driver.
 */
const request = require('supertest');
const Alert = require('../src/models/Alert');
const SensorLog = require('../src/models/SensorLog');
const User = require('../src/models/User');
const statusStore = require('../src/services/statusStore');
const { startStack, registerParent, createDriver } = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

const api = () => request(stack.app);

/** An admin account (the only accounts that can create monitor links). */
async function registerAdmin() {
  const admin = await registerParent(stack.app);
  await User.updateOne({ _id: admin.user.id }, { role: 'admin' });
  return admin;
}
const asParent = (req, token) => req.set('Authorization', `Bearer ${token}`);

async function newLink(admin, driver, days) {
  const res = await asParent(api().post('/api/monitor/links'), admin.token)
    .send({ driverId: driver._id.toString(), ...(days && { days }) })
    .expect(201);
  return res.body;
}

test('an admin creates a link for a family’s driver; it runs the monitor for that driver only', async () => {
  const admin = await registerAdmin();
  const parent = await registerParent(stack.app);
  const galang = await createDriver(parent.user.id, {}, 'Galang');
  const other = await createDriver(parent.user.id, {}, 'Ana');
  const { token, link } = await newLink(admin, galang);
  expect(link).toMatchObject({ driverId: galang._id.toString(), status: 'active' });

  const device = (path) => api().post(`/api/monitor/device${path}`).set('x-monitor-token', token);
  const s = await api().get('/api/monitor/device/session').set('x-monitor-token', token).expect(200);
  expect(s.body.driver).toEqual({ id: galang._id.toString(), name: 'Galang' });
  expect(s.body.personalThresholds.perclosThreshold).toBeGreaterThan(0);

  // Asleep at the wheel. The body names another driver and face: the link decides.
  const res = await device('/ingest')
    .send({
      driverId: other._id.toString(),
      source: 'driver_monitor',
      signals: {
        ear: 0.05,
        perclos: 0.7,
        heartRate: 0,
        faceConfidence: 0.9,
        closedForS: 3,
        matchedDriver: other._id.toString(),
      },
    })
    .expect(200);
  expect(res.body.alertTriggered).toBe(true);
  const alert = await Alert.findById(res.body.alertId);
  expect(alert.driverId.toString()).toBe(galang._id.toString());
  expect(alert.type).toBe('microsleep');
  expect(alert.parentId.toString()).toBe(parent.user.id); // the family sees it, not the admin
  expect(await Alert.countDocuments({ type: 'face_match' })).toBe(0);
  expect((await SensorLog.findOne({ driverId: galang._id })).source).toBe('web_monitor');
  expect(await SensorLog.countDocuments({ driverId: other._id })).toBe(0);

  await device('/away').send({}).expect(200);
  expect(statusStore.get(galang._id.toString()).status).toBe('away');
});

test('revoked, expired, wrong and missing links are refused', async () => {
  const parent = await registerAdmin();
  const family = await registerParent(stack.app);
  const driver = await createDriver(family.user.id, {}, 'Galang');
  const { token, link } = await newLink(parent, driver, 1);
  const session = (t) => {
    const r = api().get('/api/monitor/device/session');
    return t ? r.set('x-monitor-token', t) : r;
  };
  await session(null).expect(401);
  await session('x'.repeat(24)).expect(401);
  await session(token).expect(200);

  await asParent(api().delete(`/api/monitor/links/${link.id}`), parent.token).expect(200);
  const revoked = await session(token).expect(401);
  expect(revoked.body.error).toMatch(/revoked/);

  const again = await newLink(parent, driver, 1);
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 24 * 3600 * 1000);
  const expired = await session(again.token).expect(401);
  jest.restoreAllMocks();
  expect(expired.body.error).toMatch(/expired/);

  const list = await asParent(api().get(`/api/monitor/links?driverId=${driver._id}`), parent.token).expect(200);
  expect(list.body.links.map((l) => l.status).sort()).toEqual(['active', 'revoked']);
  expect(JSON.stringify(list.body)).not.toContain(again.token);
});

test('parents never see or manage monitor links, even for their own drivers', async () => {
  const admin = await registerAdmin();
  const parent = await registerParent(stack.app);
  const driver = await createDriver(parent.user.id, {}, 'Ben');
  await asParent(api().post('/api/monitor/links'), parent.token).send({ driverId: driver._id.toString() }).expect(403);
  await asParent(api().get(`/api/monitor/links?driverId=${driver._id}`), parent.token).expect(403);
  const { link } = await newLink(admin, driver);
  await asParent(api().delete(`/api/monitor/links/${link.id}`), parent.token).expect(403);
});
