const request = require('supertest');
const { env } = require('../src/config/env');
const User = require('../src/models/User');
const mailer = require('../src/services/mailer');
const googleAuth = require('../src/services/googleAuth');
const rateLimit = require('../src/middleware/rateLimit.middleware');
const { startStack } = require('./helpers');

let stack;
const sent = [];
const lastCode = () => {
  const m = sent[sent.length - 1];
  return m && m.text.match(/\b(\d{6})\b/)[1];
};
const saved = {};

beforeAll(async () => {
  stack = await startStack();
  Object.assign(saved, {
    emailVerification: env.emailVerification,
    googleClientIds: env.googleClientIds,
    rateLimit: env.rateLimit,
    emailDailyLimit: env.emailDailyLimit,
  });
});
afterAll(async () => {
  Object.assign(env, saved);
  mailer._setSendImpl(null);
  googleAuth._setVerifier(null);
  await stack.stop();
});
beforeEach(async () => {
  await stack.reset();
  Object.assign(env, saved, {
    emailVerification: true,
    googleClientIds: ['web-client.apps.googleusercontent.com'],
  });
  rateLimit._reset();
  sent.length = 0;
  mailer._setSendImpl(async (msg) => {
    sent.push(msg);
  });
  // A fake Google: the "credential" is JSON describing the Google account.
  googleAuth._setVerifier(async (credential) => {
    if (credential.startsWith('bad')) throw new Error('Wrong recipient');
    return JSON.parse(credential.slice('token:'.length));
  });
});

const PAT = { name: 'Pat', email: 'pat@example.com', password: 'supersecret1' };
const post = (path, body) => request(stack.app).post(`/api/auth${path}`).send(body);
const googleToken = (g) =>
  `token:${JSON.stringify({ sub: 'g-123', email: PAT.email, emailVerified: true, name: 'Pat Google', ...g })}`;

async function registerVerified() {
  await post('/register', PAT).expect(201);
  await post('/verify-email', { email: PAT.email, code: lastCode() }).expect(200);
  sent.length = 0;
}

describe('forgot password', () => {
  test('a reset code sets a new password and signs in; the old password stops working', async () => {
    await registerVerified();
    const res = await post('/forgot-password', { email: PAT.email }).expect(200);
    expect(res.body).toEqual({ ok: true, retryAfterS: 60 });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/password reset code/);

    const ok = await post('/reset-password', {
      email: PAT.email,
      code: lastCode(),
      password: 'brand-new-pass',
    }).expect(200);
    expect(ok.body.token).toEqual(expect.any(String));
    await post('/login', { email: PAT.email, password: PAT.password }).expect(401);
    await post('/login', { email: PAT.email, password: 'brand-new-pass' }).expect(200);
    // single use
    await post('/reset-password', {
      email: PAT.email,
      code: lastCode(),
      password: 'another-pass1',
    }).expect(400);
  });

  test('wrong codes are counted and burn the code; unknown e-mails get the same answer', async () => {
    await registerVerified();
    await post('/forgot-password', { email: PAT.email }).expect(200);
    const bad = lastCode() === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) {
      await post('/reset-password', {
        email: PAT.email,
        code: bad,
        password: 'brand-new-pass',
      }).expect(400);
    }
    await post('/reset-password', {
      email: PAT.email,
      code: bad,
      password: 'brand-new-pass',
    }).expect(429);
    await post('/reset-password', {
      email: PAT.email,
      code: lastCode(),
      password: 'brand-new-pass',
    }).expect(429);

    const unknown = await post('/forgot-password', { email: 'nobody@example.com' }).expect(200);
    expect(unknown.body).toEqual({ ok: true, retryAfterS: 60 });
    await post('/reset-password', {
      email: 'nobody@example.com',
      code: '123456',
      password: 'whatever12',
    }).expect(400);
  });

  test('resetting also verifies an e-mail that was never verified', async () => {
    await post('/register', PAT).expect(201);
    await post('/forgot-password', { email: PAT.email }).expect(200);
    const ok = await post('/reset-password', {
      email: PAT.email,
      code: lastCode(),
      password: 'brand-new-pass',
    }).expect(200);
    expect(ok.body.user.emailVerified).toBe(true);
  });
});

describe('continue with Google', () => {
  test('is reported in /auth/config and refused when not configured', async () => {
    const cfg = await request(stack.app).get('/api/auth/config').expect(200);
    expect(cfg.body.googleClientId).toBe('web-client.apps.googleusercontent.com');
    env.googleClientIds = [];
    await post('/google', { credential: googleToken() }).expect(503);
    const off = await request(stack.app).get('/api/auth/config').expect(200);
    expect(off.body.googleClientId).toBeNull();
  });

  test('creates a verified account without a password; password login explains what to do', async () => {
    const res = await post('/google', { credential: googleToken() }).expect(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      email: PAT.email,
      name: 'Pat Google',
      emailVerified: true,
    });
    // signing in again finds the same account
    await post('/google', { credential: googleToken() }).expect(200);
    expect(await User.countDocuments({ email: PAT.email })).toBe(1);

    const pw = await post('/login', { email: PAT.email, password: 'anything12' }).expect(401);
    expect(pw.body.details.code).toBe('GOOGLE_ACCOUNT');
    // Forgot password gives a Google account a password too
    await post('/forgot-password', { email: PAT.email }).expect(200);
    await post('/reset-password', {
      email: PAT.email,
      code: lastCode(),
      password: 'now-has-pass',
    }).expect(200);
    await post('/login', { email: PAT.email, password: 'now-has-pass' }).expect(200);
  });

  test('links to an existing verified account and keeps its password', async () => {
    await registerVerified();
    const res = await post('/google', { credential: googleToken() }).expect(200);
    expect(res.body.user.name).toBe('Pat');
    await post('/login', { email: PAT.email, password: PAT.password }).expect(200);
  });

  test('takes over a never-verified registration and drops its password', async () => {
    await post('/register', { ...PAT, password: 'someone-elses' }).expect(201);
    await post('/google', { credential: googleToken() }).expect(200);
    const pw = await post('/login', { email: PAT.email, password: 'someone-elses' }).expect(401);
    expect(pw.body.details.code).toBe('GOOGLE_ACCOUNT');
  });

  test('rejects invalid tokens and unverified Google e-mails', async () => {
    await post('/google', { credential: 'bad-token-from-another-app' }).expect(401);
    await post('/google', { credential: googleToken({ emailVerified: false }) }).expect(401);
    expect(await User.countDocuments()).toBe(0);
  });
});

describe('anti-spam limits', () => {
  test('code e-mails are limited per network (IP)', async () => {
    env.rateLimit = true;
    for (let i = 0; i < 10; i += 1) {
      await post('/forgot-password', { email: `user${i}@example.com` }).expect(200);
    }
    const res = await post('/forgot-password', { email: 'one-more@example.com' }).expect(429);
    expect(res.body.details).toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterS: expect.any(Number),
    });
    expect(res.headers['retry-after']).toBeDefined();
  });

  test('password guessing on one account is limited', async () => {
    env.rateLimit = true;
    await registerVerified();
    rateLimit._reset();
    for (let i = 0; i < 10; i += 1) {
      await post('/login', { email: PAT.email, password: `wrong-${i}` }).expect(401);
    }
    await post('/login', { email: PAT.email, password: PAT.password }).expect(429);
  });

  test('the daily e-mail budget is never exceeded', async () => {
    env.emailDailyLimit = 1;
    mailer._setSendImpl(async (msg) => {
      sent.push(msg);
    }); // resets today's count
    await post('/register', PAT).expect(201);
    expect(sent).toHaveLength(1);
    await post('/register', { ...PAT, email: 'second@example.com' })
      .expect(201)
      .expect((r) => expect(r.body.emailSent).toBe(false));
    expect(sent).toHaveLength(1);
  });
});
