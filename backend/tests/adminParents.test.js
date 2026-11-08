/**
 * Admin console > Parents > "Create parent account": a temporary password, e-mailed; the parent
 * must choose their own before the account can be used. TESTING PHASE: these accounts (and only
 * these, besides admins) get the phone driver monitor.
 */
const request = require('supertest');
const User = require('../src/models/User');
const mailer = require('../src/services/mailer');
const { startStack, registerParent, createDriver } = require('./helpers');

let stack;
let sent;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => {
  await stack.reset();
  sent = [];
  mailer._setSendImpl(async (msg) => {
    sent.push(msg);
  });
});
afterEach(() => mailer._setSendImpl(null));

const api = () => request(stack.app);
const bearer = (req, token) => req.set('Authorization', `Bearer ${token}`);

async function registerAdmin() {
  const admin = await registerParent(stack.app);
  await User.updateOne({ _id: admin.user.id }, { role: 'admin' });
  return admin;
}

test('admin creates a parent; they must replace the temporary password, then get the phone monitor', async () => {
  const admin = await registerAdmin();
  const res = await bearer(api().post('/api/admin/parents'), admin.token)
    .send({ name: 'Galang', email: 'Galang.Test@Example.com' })
    .expect(201);
  const temp = res.body.temporaryPassword;
  expect(temp).toMatch(/^[A-Za-z2-9]{10}$/);
  expect(res.body.emailSent).toBe(true);
  expect(sent[0].to).toBe('galang.test@example.com');
  expect(sent[0].text).toContain(temp);

  // Signing in with the temporary password: no session, change it first.
  const login = await api().post('/api/auth/login').send({ email: 'galang.test@example.com', password: temp });
  expect(login.status).toBe(403);
  expect(login.body.details.code).toBe('PASSWORD_CHANGE_REQUIRED');
  expect(login.body.token).toBeUndefined();

  const change = (body) => api().post('/api/auth/change-temporary-password').send({ email: 'galang.test@example.com', ...body });
  await change({ password: 'wrong-pass', newPassword: 'mynewpass1' }).expect(401);
  await change({ password: temp, newPassword: temp }).expect(400);
  const done = await change({ password: temp, newPassword: 'mynewpass1' }).expect(200);
  expect(done.body.token).toBeTruthy();
  expect(done.body.user).toMatchObject({ createdByAdmin: true, phoneMonitor: true, emailVerified: true });
  await change({ password: 'mynewpass1', newPassword: 'another123' }).expect(409);

  // Normal sign-in now works with their own password, and the old one doesn't.
  await api().post('/api/auth/login').send({ email: 'galang.test@example.com', password: temp }).expect(401);
  const ok = await api().post('/api/auth/login').send({ email: 'galang.test@example.com', password: 'mynewpass1' }).expect(200);

  // Their drivers get monitor links.
  const driver = await createDriver(ok.body.user.id, {}, 'Colleague');
  await bearer(api().post('/api/monitor/links'), ok.body.token).send({ driverId: driver._id.toString() }).expect(201);
});

test('self-registered parents never get the phone monitor; only admins create accounts', async () => {
  const parent = await registerParent(stack.app);
  const me = await bearer(api().get('/api/auth/me'), parent.token).expect(200);
  expect(me.body.user ?? me.body).toMatchObject({ phoneMonitor: false });
  const driver = await createDriver(parent.user.id, {}, 'Ben');
  await bearer(api().post('/api/monitor/links'), parent.token).send({ driverId: driver._id.toString() }).expect(403);
  await bearer(api().post('/api/admin/parents'), parent.token).send({ name: 'X', email: 'x@example.com' }).expect(403);
});

test('an admin-created parent cannot make links for another family’s driver', async () => {
  const admin = await registerAdmin();
  const created = await bearer(api().post('/api/admin/parents'), admin.token)
    .send({ name: 'Ana', email: 'ana@example.com' })
    .expect(201);
  const signedIn = await api()
    .post('/api/auth/change-temporary-password')
    .send({ email: 'ana@example.com', password: created.body.temporaryPassword, newPassword: 'anapass123' })
    .expect(200);
  const other = await registerParent(stack.app);
  const theirs = await createDriver(other.user.id, {}, 'Ben');
  await bearer(api().post('/api/monitor/links'), signedIn.body.token).send({ driverId: theirs._id.toString() }).expect(404);
});

test('an admin cannot create an account for an e-mail that already has one', async () => {
  const admin = await registerAdmin();
  await bearer(api().post('/api/admin/parents'), admin.token).send({ name: 'A', email: admin.user.email }).expect(409);
});
