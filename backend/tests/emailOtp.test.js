const request = require('supertest');
const { env } = require('../src/config/env');
const User = require('../src/models/User');
const mailer = require('../src/services/mailer');
const { startStack } = require('./helpers');

let stack;
const sent = [];
const lastCode = () => {
  const m = sent[sent.length - 1];
  return m && m.text.match(/\b(\d{6})\b/)[1];
};

beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  env.emailVerification = false;
  mailer._setSendImpl(null);
  await stack.stop();
});
beforeEach(async () => {
  await stack.reset();
  sent.length = 0;
  env.emailVerification = true;
  mailer._setSendImpl(async (msg) => {
    sent.push(msg);
  });
});

const NEW = { name: 'Pat', email: 'pat@example.com', password: 'supersecret1' };
const post = (path, body) => request(stack.app).post(`/api/auth${path}`).send(body);

describe('e-mail verification with a 6-digit code', () => {
  test('register sends a code and returns no token; the right code signs in', async () => {
    const reg = await post('/register', NEW).expect(201);
    expect(reg.body).toEqual({ verificationRequired: true, email: NEW.email, retryAfterS: 60 });
    expect(reg.body.token).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(NEW.email);
    expect(sent[0].subject).toMatch(/^\d{6} is your Guardian Drive code$/);
    expect(sent[0].html).toContain(lastCode());

    // Stored only as a hash
    const stored = await User.findOne({ email: NEW.email }).select('+emailOtp');
    expect(JSON.stringify(stored.emailOtp)).not.toContain(lastCode());

    const ok = await post('/verify-email', { email: NEW.email, code: lastCode() }).expect(200);
    expect(ok.body.token).toEqual(expect.any(String));
    expect(ok.body.user).toMatchObject({ email: NEW.email, emailVerified: true });
    await post('/login', { email: NEW.email, password: NEW.password }).expect(200);
    // Code is single-use
    await post('/verify-email', { email: NEW.email, code: lastCode() }).expect(409);
  });

  test('signing in before verifying is refused and re-sends a code (after the cooldown)', async () => {
    await post('/register', NEW).expect(201);
    const res = await post('/login', { email: NEW.email, password: NEW.password }).expect(403);
    expect(res.body.details).toMatchObject({ code: 'EMAIL_NOT_VERIFIED', email: NEW.email });
    expect(sent).toHaveLength(1); // still inside the 60 s cooldown: no extra e-mail
    // wrong password never reveals the verification state
    await post('/login', { email: NEW.email, password: 'wrong-password' }).expect(401);
  });

  test('wrong codes count; 5 wrong burn the code; resend issues a new one', async () => {
    await post('/register', NEW).expect(201);
    const good = lastCode();
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) {
      await post('/verify-email', { email: NEW.email, code: bad }).expect(400);
    }
    const fifth = await post('/verify-email', { email: NEW.email, code: bad }).expect(429);
    expect(fifth.body.details.code).toBe('too_many_attempts');
    await post('/verify-email', { email: NEW.email, code: good }).expect(429); // burnt

    // Cooldown: resend right away doesn't send…
    let r = await post('/resend-code', { email: NEW.email }).expect(200);
    expect(sent).toHaveLength(1);
    expect(r.body.retryAfterS).toBeGreaterThan(0);
    // …after it, a new code works
    await User.updateOne(
      { email: NEW.email },
      { 'emailOtp.sentAt': new Date(Date.now() - 61_000) },
    );
    r = await post('/resend-code', { email: NEW.email }).expect(200);
    expect(sent).toHaveLength(2);
    await post('/verify-email', { email: NEW.email, code: lastCode() }).expect(200);
  });

  test('expired codes are rejected', async () => {
    await post('/register', NEW).expect(201);
    await User.updateOne(
      { email: NEW.email },
      { 'emailOtp.expiresAt': new Date(Date.now() - 1000) },
    );
    const res = await post('/verify-email', { email: NEW.email, code: lastCode() }).expect(400);
    expect(res.body.details.code).toBe('expired');
  });

  test('resend gives the same answer for unknown e-mails (no account enumeration)', async () => {
    const res = await post('/resend-code', { email: 'nobody@example.com' }).expect(200);
    expect(res.body).toEqual({ ok: true, retryAfterS: 60 });
    expect(sent).toHaveLength(0);
    await post('/verify-email', { email: 'nobody@example.com', code: '123456' }).expect(400);
    await post('/verify-email', { email: NEW.email, code: '12ab56' }).expect(400);
  });

  test('accounts created before verification existed can still sign in', async () => {
    env.emailVerification = false;
    await post('/register', NEW).expect(201); // no emailVerified field stored
    env.emailVerification = true;
    const res = await post('/login', { email: NEW.email, password: NEW.password }).expect(200);
    expect(res.body.user.emailVerified).toBe(true);
  });

  test('an e-mail outage does not lose the registration', async () => {
    mailer._setSendImpl(async () => {
      throw new Error('Brevo 401');
    });
    const reg = await post('/register', NEW).expect(201);
    expect(reg.body.verificationRequired).toBe(true);
    expect(await User.countDocuments({ email: NEW.email })).toBe(1);
  });
});
