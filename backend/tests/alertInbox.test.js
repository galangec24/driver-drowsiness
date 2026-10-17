const request = require('supertest');
const Alert = require('../src/models/Alert');
const { startOfLocalDay, isExpired } = require('../src/utils/alertDay');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  DROWSY_SIGNALS,
} = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const DAY = 24 * 3600 * 1000;

async function makeAlert(driverId) {
  const res = await request(stack.app)
    .post('/api/ingest')
    .set('x-api-key', API_KEY)
    .send(ingestPayload(driverId, DROWSY_SIGNALS))
    .expect(200);
  return res.body.alertId;
}

/** Three alerts for one parent: two from today, one from two days ago (never acknowledged). */
async function setup() {
  const parent = await registerParent(stack.app);
  const driver = await createDriver(parent.user.id);
  const a = await makeAlert(driver._id);
  // Cooldowns: move each alert out of the way by giving the next one a different driver.
  const driver2 = await createDriver(parent.user.id);
  const b = await makeAlert(driver2._id);
  const driver3 = await createDriver(parent.user.id);
  const old = await makeAlert(driver3._id);
  await Alert.collection.updateOne(
    { _id: (await Alert.findById(old))._id },
    { $set: { createdAt: new Date(Date.now() - 2 * DAY) } },
  );
  return { parent, a, b, old };
}

describe('alert day (acknowledge by the end of the day, family time zone)', () => {
  test('midnight follows the time zone, not UTC', () => {
    // 23:30 in Manila on Oct 17 → the day started at 16:00 UTC on Oct 16
    expect(startOfLocalDay(new Date('2026-10-17T15:30:00Z'), 'Asia/Manila').toISOString()).toBe(
      '2026-10-16T16:00:00.000Z',
    );
    // 00:30 on Oct 18 in Manila → a new day
    expect(startOfLocalDay(new Date('2026-10-17T16:30:00Z'), 'Asia/Manila').toISOString()).toBe(
      '2026-10-17T16:00:00.000Z',
    );
  });

  test('an unacknowledged alert expires at the next midnight; acknowledged ones never do', () => {
    const now = new Date('2026-10-17T16:30:00Z'); // 00:30 Oct 18, Manila
    const lastNight = { acknowledged: false, createdAt: new Date('2026-10-17T15:00:00Z') };
    const justNow = { acknowledged: false, createdAt: new Date('2026-10-17T16:10:00Z') };
    expect(isExpired(lastNight, now, 'Asia/Manila')).toBe(true);
    expect(isExpired(justNow, now, 'Asia/Manila')).toBe(false);
    expect(isExpired({ ...lastNight, acknowledged: true }, now, 'Asia/Manila')).toBe(false);
  });
});

describe('expired alerts', () => {
  test('a previous-day alert cannot be acknowledged or labelled, only removed', async () => {
    const { parent, old } = await setup();
    const list = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
    const expired = list.body.alerts.find((x) => x.id === old);
    expect(expired.expired).toBe(true);
    expect(list.body.expired).toBe(1);
    expect(list.body.unacknowledged).toBe(2); // only today's still count

    const ack = await request(stack.app)
      .patch(`/api/alerts/${old}/ack`)
      .set(auth(parent.token))
      .send({ acknowledgedBy: 'web' })
      .expect(409);
    expect(ack.body.error).toMatch(/previous day/);
    await request(stack.app)
      .patch(`/api/alerts/${old}/feedback`)
      .set(auth(parent.token))
      .send({ falseAlarm: true })
      .expect(409);
    expect((await Alert.findById(old)).acknowledged).toBe(false);

    const byStatus = await request(stack.app)
      .get('/api/alerts?status=expired')
      .set(auth(parent.token))
      .expect(200);
    expect(byStatus.body.alerts.map((x) => x.id)).toEqual([old]);
    const open = await request(stack.app)
      .get('/api/alerts?status=open')
      .set(auth(parent.token))
      .expect(200);
    expect(open.body.alerts).toHaveLength(2);
  });

  test('today’s alerts can still be acknowledged', async () => {
    const { parent, a } = await setup();
    const r = await request(stack.app)
      .patch(`/api/alerts/${a}/ack`)
      .set(auth(parent.token))
      .send({ acknowledgedBy: 'web' })
      .expect(200);
    expect(r.body.alert.acknowledged).toBe(true);
    expect(r.body.alert.read).toBe(true); // acknowledging also reads the notification
  });
});

describe('removing alerts', () => {
  test('one alert, or all expired ones at once; removed alerts leave every list and count', async () => {
    const { parent, a, b, old } = await setup();
    await request(stack.app).delete(`/api/alerts/${a}`).set(auth(parent.token)).expect(200);
    let list = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
    expect(list.body.alerts.map((x) => x.id).sort()).toEqual([b, old].sort());
    expect(list.body.unread).toBe(2);

    const bulk = await request(stack.app)
      .post('/api/alerts/remove')
      .set(auth(parent.token))
      .send({ expired: true })
      .expect(200);
    expect(bulk.body.alertIds).toEqual([old]);
    list = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
    expect(list.body.alerts.map((x) => x.id)).toEqual([b]);
    expect(list.body.expired).toBe(0);

    // Gone for the parent (kept for tuning/training), and no longer acknowledgeable.
    expect((await Alert.findById(a)).removedAt).toBeTruthy();
    await request(stack.app).patch(`/api/alerts/${a}/ack`).set(auth(parent.token)).expect(404);
  });

  test('another family cannot remove or read someone else’s alerts', async () => {
    const { a } = await setup();
    const stranger = await registerParent(stack.app);
    await request(stack.app).delete(`/api/alerts/${a}`).set(auth(stranger.token)).expect(404);
    await request(stack.app)
      .patch(`/api/alerts/${a}/read`)
      .set(auth(stranger.token))
      .send({})
      .expect(404);
    expect((await Alert.findById(a)).removedAt).toBeUndefined();
  });
});

describe('notifications: read / unread', () => {
  test('mark read and unread, filter by it, and mark all read', async () => {
    const { parent, a, b } = await setup();
    let list = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
    expect(list.body.unread).toBe(3);
    expect(list.body.alerts.every((x) => x.read === false)).toBe(true);

    await request(stack.app)
      .patch(`/api/alerts/${a}/read`)
      .set(auth(parent.token))
      .send({})
      .expect(200);
    const read = await request(stack.app)
      .get('/api/alerts?read=true')
      .set(auth(parent.token))
      .expect(200);
    expect(read.body.alerts.map((x) => x.id)).toEqual([a]);
    const unread = await request(stack.app)
      .get('/api/alerts?read=false')
      .set(auth(parent.token))
      .expect(200);
    expect(unread.body.alerts).toHaveLength(2);
    expect(unread.body.unread).toBe(2);

    await request(stack.app)
      .patch(`/api/alerts/${a}/read`)
      .set(auth(parent.token))
      .send({ read: false })
      .expect(200);
    list = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
    expect(list.body.unread).toBe(3);

    const all = await request(stack.app)
      .post('/api/alerts/read-all')
      .set(auth(parent.token))
      .send({})
      .expect(200);
    expect(all.body.updated).toBe(3);
    list = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
    expect(list.body.unread).toBe(0);
    // Reading is not acknowledging
    expect(list.body.alerts.find((x) => x.id === b).acknowledged).toBe(false);
  });
});
