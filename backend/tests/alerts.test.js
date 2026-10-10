const request = require('supertest');
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

async function makeAlert(driverId, signals = DROWSY_SIGNALS) {
  const res = await request(stack.app)
    .post('/api/ingest')
    .set('x-api-key', API_KEY)
    .send(ingestPayload(driverId, signals))
    .expect(200);
  return res.body.alertId;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('GET /api/alerts', () => {
  test('lists only the parent’s alerts, newest first, with filters', async () => {
    const parent = await registerParent(stack.app);
    const d1 = await createDriver(parent.user.id);
    const d2 = await createDriver(parent.user.id);
    const stranger = await registerParent(stack.app);
    const d3 = await createDriver(stranger.user.id);

    await makeAlert(d1._id);
    await makeAlert(d2._id, WARNING_SIGNALS);
    await makeAlert(d3._id);

    const all = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
    expect(all.body.alerts).toHaveLength(2);
    expect(all.body.unacknowledged).toBe(2);
    expect(all.body.alerts[0].driverName).toMatch(/^Test Driver/);
    expect(new Date(all.body.alerts[0].createdAt) >= new Date(all.body.alerts[1].createdAt)).toBe(
      true,
    );

    const byDriver = await request(stack.app)
      .get(`/api/alerts?driverId=${d2._id}`)
      .set(auth(parent.token))
      .expect(200);
    expect(byDriver.body.alerts).toHaveLength(1);
    expect(byDriver.body.alerts[0].type).toBe('warning');

    const future = new Date(Date.now() + 60000).toISOString();
    const none = await request(stack.app)
      .get(`/api/alerts?from=${encodeURIComponent(future)}`)
      .set(auth(parent.token))
      .expect(200);
    expect(none.body.alerts).toHaveLength(0);

    await request(stack.app).get('/api/alerts?from=garbage').set(auth(parent.token)).expect(400);
  });

  test('requires JWT', async () => {
    await request(stack.app).get('/api/alerts').expect(401);
  });
});

describe('PATCH /api/alerts/:id/ack', () => {
  test('first acknowledge wins and every parent session is notified', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const alertId = await makeAlert(driver._id);

    // Two devices of the same parent (web + APK).
    const web = await connectSocket(stack.url, parent.token);
    const apk = await connectSocket(stack.url, parent.token);
    const webEvt = waitForEvent(web, 'alert:acknowledged');
    const apkEvt = waitForEvent(apk, 'alert:acknowledged');

    const first = await request(stack.app)
      .patch(`/api/alerts/${alertId}/ack`)
      .set(auth(parent.token))
      .send({ acknowledgedBy: 'apk' })
      .expect(200);
    expect(first.body.alreadyAcknowledged).toBe(false);
    expect(first.body.alert).toMatchObject({ acknowledged: true, acknowledgedBy: 'apk' });

    expect(await webEvt).toEqual({ alertId, acknowledgedBy: 'apk' });
    expect(await apkEvt).toEqual({ alertId, acknowledgedBy: 'apk' });

    const second = await request(stack.app)
      .patch(`/api/alerts/${alertId}/ack`)
      .set(auth(parent.token))
      .send({ acknowledgedBy: 'web' })
      .expect(200);
    expect(second.body.alreadyAcknowledged).toBe(true);
    expect(second.body.alert.acknowledgedBy).toBe('apk');

    web.close();
    apk.close();
  });

  test('concurrent acknowledges: exactly one wins', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const alertId = await makeAlert(driver._id);
    const results = await Promise.all(
      ['web', 'apk', 'web', 'apk'].map((by) =>
        request(stack.app)
          .patch(`/api/alerts/${alertId}/ack`)
          .set(auth(parent.token))
          .send({ acknowledgedBy: by }),
      ),
    );
    expect(results.filter((r) => r.body.alreadyAcknowledged === false)).toHaveLength(1);
  });

  test('cannot acknowledge another parent’s alert', async () => {
    const owner = await registerParent(stack.app);
    const driver = await createDriver(owner.user.id);
    const alertId = await makeAlert(driver._id);
    const intruder = await registerParent(stack.app);
    await request(stack.app)
      .patch(`/api/alerts/${alertId}/ack`)
      .set(auth(intruder.token))
      .expect(404);
  });

  test('invalid id → 400, unknown id → 404, bad acknowledgedBy → 400', async () => {
    const parent = await registerParent(stack.app);
    await request(stack.app).patch('/api/alerts/xyz/ack').set(auth(parent.token)).expect(400);
    await request(stack.app)
      .patch('/api/alerts/aaaaaaaaaaaaaaaaaaaaaaaa/ack')
      .set(auth(parent.token))
      .expect(404);
    await request(stack.app)
      .patch('/api/alerts/aaaaaaaaaaaaaaaaaaaaaaaa/ack')
      .set(auth(parent.token))
      .send({ acknowledgedBy: 'fax' })
      .expect(400);
  });
});

describe('false-alarm feedback (training labels for the verifier)', () => {
  test('acknowledge with falseAlarm labels the alert and tells every session', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const alertId = await makeAlert(driver._id);
    const web = await connectSocket(stack.url, parent.token);
    const evt = waitForEvent(web, 'alert:acknowledged');

    const res = await request(stack.app)
      .patch(`/api/alerts/${alertId}/ack`)
      .set(auth(parent.token))
      .send({ acknowledgedBy: 'apk', falseAlarm: true })
      .expect(200);
    expect(res.body.alert).toMatchObject({ acknowledged: true, falseAlarm: true });
    expect(await evt).toEqual({ alertId, acknowledgedBy: 'apk', falseAlarm: true });
    web.close();
  });

  test('feedback can be given after acknowledging, and is broadcast', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const alertId = await makeAlert(driver._id);
    await request(stack.app)
      .patch(`/api/alerts/${alertId}/ack`)
      .set(auth(parent.token))
      .expect(200);

    const list0 = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
    expect(list0.body.alerts[0].falseAlarm).toBeNull();

    const web = await connectSocket(stack.url, parent.token);
    const evt = waitForEvent(web, 'alert:feedback');
    await request(stack.app)
      .patch(`/api/alerts/${alertId}/feedback`)
      .set(auth(parent.token))
      .send({ falseAlarm: false, by: 'web' })
      .expect(200);
    expect(await evt).toEqual({ alertId, falseAlarm: false });
    const list = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
    expect(list.body.alerts[0].falseAlarm).toBe(false);
    web.close();
  });

  test('feedback validation and ownership', async () => {
    const owner = await registerParent(stack.app);
    const driver = await createDriver(owner.user.id);
    const alertId = await makeAlert(driver._id);
    const intruder = await registerParent(stack.app);
    await request(stack.app)
      .patch(`/api/alerts/${alertId}/feedback`)
      .set(auth(owner.token))
      .send({ falseAlarm: 'yes' })
      .expect(400);
    await request(stack.app)
      .patch(`/api/alerts/${alertId}/feedback`)
      .set(auth(intruder.token))
      .send({ falseAlarm: true })
      .expect(404);
  });
});
