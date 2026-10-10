const request = require('supertest');
const { startStack, registerParent, connectSocket } = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

describe('POST /api/auth/register', () => {
  test('creates a parent and returns a JWT', async () => {
    const res = await request(stack.app)
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'ADA@Example.com', password: 'longpassword' })
      .expect(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ name: 'Ada', email: 'ada@example.com', role: 'parent' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test('rejects duplicate email with 409', async () => {
    const body = { name: 'Ada', email: 'dup@example.com', password: 'longpassword' };
    await request(stack.app).post('/api/auth/register').send(body).expect(201);
    await request(stack.app).post('/api/auth/register').send(body).expect(409);
  });

  test('rejects short password with 400', async () => {
    await request(stack.app)
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'x@example.com', password: 'short' })
      .expect(400);
  });
});

describe('POST /api/auth/login', () => {
  test('returns a JWT for valid credentials', async () => {
    const { user, password } = await registerParent(stack.app);
    const res = await request(stack.app)
      .post('/api/auth/login')
      .send({ email: user.email, password })
      .expect(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.id).toBe(user.id);
  });

  test('rejects a wrong password with 401 and no stack trace', async () => {
    const { user } = await registerParent(stack.app);
    const res = await request(stack.app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'wrong-password' })
      .expect(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
  });

  test('rejects unknown email with 401', async () => {
    await request(stack.app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever123' })
      .expect(401);
  });
});

describe('JWT-protected routes', () => {
  test('GET /api/auth/me requires a token', async () => {
    await request(stack.app).get('/api/auth/me').expect(401);
    const { token, user } = await registerParent(stack.app);
    const res = await request(stack.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.user.id).toBe(user.id);
  });

  test('rejects a tampered token', async () => {
    await request(stack.app)
      .get('/api/drivers')
      .set('Authorization', 'Bearer abc.def.ghi')
      .expect(401);
  });

  test('socket handshake rejects missing/invalid JWT and accepts a valid one', async () => {
    await expect(connectSocket(stack.url, undefined)).rejects.toThrow('unauthorized');
    await expect(connectSocket(stack.url, 'bad-token')).rejects.toThrow('unauthorized');
    const { token } = await registerParent(stack.app);
    const socket = await connectSocket(stack.url, token);
    expect(socket.connected).toBe(true);
    socket.close();
  });
});
