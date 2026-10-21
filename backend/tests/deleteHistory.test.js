const request = require('supertest');
const Alert = require('../src/models/Alert');
const Driver = require('../src/models/Driver');
const SensorLog = require('../src/models/SensorLog');
const mailer = require('../src/services/mailer');
const { startStack, registerParent, createDriver } = require('./helpers');

let stack;
const sent = [];
const lastCode = () => sent[sent.length - 1].text.match(/\b(\d{6})\b/)[1];
const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  mailer._setSendImpl(null);
  await stack.stop();
});
beforeEach(async () => {
  await stack.reset();
  sent.length = 0;
  mailer._setSendImpl(null);
});

describe('deleting a driver needs an e-mailed code', () => {
  beforeEach(() => mailer._setSendImpl(async (msg) => sent.push(msg)));

  test('code is e-mailed to the owner and only it authorizes the deletion', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id, {}, 'Miguel');
    const url = `/api/drivers/${driver._id}`;

    // No code: refused.
    const none = await request(stack.app).delete(url).set(auth(parent.token)).send({}).expect(400);
    expect(none.body.details.code).toBe('CODE_REQUIRED');

    const res = await request(stack.app)
      .post(`${url}/delete-code`)
      .set(auth(parent.token))
      .expect(200);
    expect(res.body).toMatchObject({ method: 'email', email: parent.user.email, sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(parent.user.email);
    expect(sent[0].text).toContain('Driver: Miguel');

    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    await request(stack.app).delete(url).set(auth(parent.token)).send({ code: wrong }).expect(400);
    expect(await Driver.countDocuments()).toBe(1);

    await Alert.create({
      driverId: driver._id,
      parentId: parent.user.id,
      type: 'drowsy',
      severity: 'high',
    }).catch(() => null);
    await request(stack.app).delete(url).set(auth(parent.token)).send({ code }).expect(204);
    expect(await Driver.countDocuments()).toBe(0);
    expect(await Alert.countDocuments({ driverId: driver._id })).toBe(0);
  });

  test("a code for one driver can't delete another", async () => {
    const parent = await registerParent(stack.app);
    const a = await createDriver(parent.user.id, {}, 'Ana');
    const b = await createDriver(parent.user.id, {}, 'Ben');
    await request(stack.app)
      .post(`/api/drivers/${a._id}/delete-code`)
      .set(auth(parent.token))
      .expect(200);
    await request(stack.app)
      .delete(`/api/drivers/${b._id}`)
      .set(auth(parent.token))
      .send({ code: lastCode() })
      .expect(400);
    expect(await Driver.countDocuments()).toBe(2);
  });

  test("another parent can't request a code", async () => {
    const owner = await registerParent(stack.app);
    const driver = await createDriver(owner.user.id);
    const intruder = await registerParent(stack.app);
    await request(stack.app)
      .post(`/api/drivers/${driver._id}/delete-code`)
      .set(auth(intruder.token))
      .expect(404);
    expect(sent).toHaveLength(0);
  });
});

describe('without an e-mail provider', () => {
  test("the parent types the driver's name instead", async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id, {}, 'Liza');
    const url = `/api/drivers/${driver._id}`;
    const res = await request(stack.app)
      .post(`${url}/delete-code`)
      .set(auth(parent.token))
      .expect(200);
    expect(res.body).toEqual({ method: 'name' });
    await request(stack.app)
      .delete(url)
      .set(auth(parent.token))
      .send({ confirmName: 'Lisa' })
      .expect(400);
    await request(stack.app)
      .delete(url)
      .set(auth(parent.token))
      .send({ confirmName: ' liza ' })
      .expect(204);
  });
});

describe('reading history', () => {
  test('per-minute rows with km driven, newest first, and the last reading', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const t0 = new Date(Math.floor(Date.now() / 60e3) * 60e3 - 10 * 60e3); // on a minute boundary
    const at = (min, sec = 0) => new Date(t0.getTime() + min * 60e3 + sec * 1000);
    const log = (createdAt, classification, location) => ({
      driverId: driver._id,
      signals: { ear: 0.3, perclos: 0.1, heartRate: 70 },
      classification,
      fusionScore: classification === 'drowsy' ? 0.8 : 0.2,
      source: 'driver_monitor',
      createdAt,
      ...(location && { location }),
    });
    // Minute 0: parked (two fixes a few metres apart = GPS jitter, not distance).
    // Minute 1: ~1.11 km north. Minute 2: drowsy, no GPS. Minute 3: another ~1.11 km.
    await SensorLog.insertMany([
      log(at(0, 1), 'alert', { lat: 14.5, lng: 121 }),
      log(at(0, 30), 'alert', { lat: 14.50002, lng: 121 }),
      log(at(1, 10), 'warning', { lat: 14.51, lng: 121 }),
      log(at(2, 5), 'drowsy'),
      log(at(2, 6), 'alert'),
      log(at(3, 20), 'alert', { lat: 14.52, lng: 121 }),
    ]);
    const res = await request(stack.app)
      .get(`/api/drivers/${driver._id}/history`)
      .set(auth(parent.token))
      .expect(200);
    const { rows, totalKm, lastReading } = res.body;
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.classification)).toEqual(['alert', 'drowsy', 'warning', 'alert']);
    expect(rows[3].km).toBe(0);
    expect(rows[2].km).toBeCloseTo(1.11, 1);
    expect(rows[1].km).toBe(0);
    expect(rows[1].location).toBeNull();
    expect(rows[0].totalKm).toBeCloseTo(2.22, 1);
    expect(totalKm).toBeCloseTo(2.22, 1);
    expect(rows[2].readings).toBe(1);
    expect(new Date(lastReading.at).getTime()).toBe(at(3, 20).getTime());
  });

  test('other parents get 404', async () => {
    const owner = await registerParent(stack.app);
    const driver = await createDriver(owner.user.id);
    const other = await registerParent(stack.app);
    await request(stack.app)
      .get(`/api/drivers/${driver._id}/history`)
      .set(auth(other.token))
      .expect(404);
  });
});
