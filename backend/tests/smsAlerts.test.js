/**
 * Drowsiness texts to the parent's phone: once per alert, only drowsy / microsleep, in the
 * parent's language, never without a number; phone numbers at sign-up and in the profile.
 */
const request = require('supertest');
const Alert = require('../src/models/Alert');
const sms = require('../src/services/sms');
const smsAlerts = require('../src/services/smsAlerts');
const { env } = require('../src/config/env');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  DROWSY_SIGNALS,
  WARNING_SIGNALS,
} = require('./helpers');

let stack;
let sent;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  sms._setSendImpl(null);
  await stack.stop();
});
beforeEach(async () => {
  await stack.reset();
  smsAlerts._reset();
  sent = [];
  sms._setSendImpl(async (to, text) => {
    sent.push({ to, text });
  });
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ingest = (body) =>
  request(stack.app).post('/api/ingest').set('x-api-key', API_KEY).send(body);

/** The text is sent after the reading is answered: wait for the alert's sms status. */
async function smsStatus(alertId) {
  for (let i = 0; i < 100; i += 1) {
    const a = await Alert.findById(alertId).lean();
    if (a && a.sms && a.sms.status !== 'sending') return a.sms.status;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

async function parentWithPhone(phone = '09171234567', language) {
  const parent = await registerParent(stack.app);
  await request(stack.app)
    .patch('/api/auth/me')
    .set(auth(parent.token))
    .send({ phone, ...(language && { language }) })
    .expect(200);
  return parent;
}

describe('phone numbers', () => {
  test('normalised to +63… (Philippine numbers without a country code)', () => {
    expect(sms.normalizePhone('0917 123 4567')).toBe('+639171234567');
    expect(sms.normalizePhone('+63 917-123-4567')).toBe('+639171234567');
    expect(sms.normalizePhone('639171234567')).toBe('+639171234567');
    expect(sms.normalizePhone('9171234567')).toBe('+639171234567');
    expect(sms.normalizePhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(sms.normalizePhone('12345')).toBeNull();
    expect(sms.normalizePhone('')).toBeNull();
    expect(sms.maskPhone('+639171234567')).toBe('+63•••••4567');
  });

  test('can be given at sign-up, and a wrong one is refused', async () => {
    const res = await request(stack.app)
      .post('/api/auth/register')
      .send({
        name: 'Pat',
        email: 'pat-sms@example.com',
        password: 'supersecret1',
        phone: '0917 123 4567',
      })
      .expect(201);
    expect(res.body.user.phone).toBe('+639171234567');
    await request(stack.app)
      .post('/api/auth/register')
      .send({ name: 'Sam', email: 'sam-sms@example.com', password: 'supersecret1', phone: '12345' })
      .expect(400);
  });

  test('profile: saved as +63…, removable, and a wrong one is refused', async () => {
    const parent = await registerParent(stack.app);
    const me = (phone) =>
      request(stack.app).patch('/api/auth/me').set(auth(parent.token)).send({ phone });
    expect((await me('0917 123 4567').expect(200)).body.user.phone).toBe('+639171234567');
    await me('call me').expect(400);
    expect((await me('').expect(200)).body.user.phone).toBe('');
  });
});

describe('drowsiness texts', () => {
  test('a drowsy alert texts the parent once, with the driver, time and map link', async () => {
    const parent = await parentWithPhone();
    const driver = await createDriver(parent.user.id, {}, 'Galang');
    const res = await ingest(
      ingestPayload(driver._id, DROWSY_SIGNALS, { location: { lat: 10.33446, lng: 123.8952 } }),
    ).expect(200);
    expect(await smsStatus(res.body.alertId)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('+639171234567');
    expect(sent[0].text).toMatch(/^Guardian Drive: Galang (is DROWSY|briefly FELL ASLEEP)/);
    expect(sent[0].text).toContain('https://maps.google.com/?q=10.33446,123.89520');

    // Detected again (grouped into the same alert): no second text.
    require('../src/services/ingestService').resetCooldowns();
    await ingest(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(1);

    const alert = await request(stack.app).get('/api/alerts').set(auth(parent.token)).expect(200);
    expect(alert.body.alerts[0].sms).toMatchObject({ to: '+63•••••4567' });
  });

  test('a warning is not texted, but texts once it escalates to drowsy', async () => {
    const parent = await parentWithPhone();
    const driver = await createDriver(parent.user.id);
    const warn = await ingest(ingestPayload(driver._id, WARNING_SIGNALS)).expect(200);
    expect(warn.body.alertTriggered).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(0);

    const drowsy = await ingest(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);
    expect(drowsy.body.alertId).toBe(warn.body.alertId); // same alert, escalated
    expect(await smsStatus(drowsy.body.alertId)).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  test('in the parent language (Filipino)', async () => {
    const parent = await parentWithPhone('+639171234567', 'fil');
    const driver = await createDriver(parent.user.id, {}, 'Ana');
    const res = await ingest(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);
    await smsStatus(res.body.alertId);
    expect(sent[0].text).toMatch(/^Guardian Drive: (Inaantok si Ana|Saglit na nakatulog si Ana)/);
  });

  test('no number: nothing is sent, the alert notes it', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const res = await ingest(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);
    expect(await smsStatus(res.body.alertId)).toBe('no_phone');
    expect(sent).toHaveLength(0);
  });

  test('a provider failure is recorded and never breaks the reading', async () => {
    sms._setSendImpl(async () => {
      throw new Error('no credits');
    });
    const parent = await parentWithPhone();
    const driver = await createDriver(parent.user.id);
    const res = await ingest(ingestPayload(driver._id, DROWSY_SIGNALS)).expect(200);
    expect(res.body.alertTriggered).toBe(true);
    expect(await smsStatus(res.body.alertId)).toBe('failed');
  });

  test('at most SMS_PER_PARENT_DAILY texts per parent per day', async () => {
    const saved = env.sms.perParentDaily;
    env.sms.perParentDaily = 1;
    try {
      const parent = await parentWithPhone();
      const a = await createDriver(parent.user.id, {}, 'A');
      const b = await createDriver(parent.user.id, {}, 'B');
      const r1 = await ingest(ingestPayload(a._id, DROWSY_SIGNALS)).expect(200);
      expect(await smsStatus(r1.body.alertId)).toBe('sent');
      const r2 = await ingest(ingestPayload(b._id, DROWSY_SIGNALS)).expect(200);
      expect(await smsStatus(r2.body.alertId)).toBe('limit');
      expect(sent).toHaveLength(1);
    } finally {
      env.sms.perParentDaily = saved;
    }
  });

  test('message texts fit in one or two SMS', () => {
    for (const language of ['en', 'fil', 'ceb', 'ja']) {
      for (const type of ['drowsy', 'microsleep']) {
        const text = smsAlerts.buildText({
          type,
          driverName: 'Maria Clara',
          at: new Date(),
          location: { lat: 10.334461, lng: 123.895201 },
          language,
        });
        expect(text.length).toBeLessThanOrEqual(306);
      }
    }
  });
});
