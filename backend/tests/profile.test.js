const request = require('supertest');
const { startStack, registerParent, createDriver } = require('./helpers');
const Message = require('../src/models/Message');

let stack;
const auth = (token) => ({ Authorization: `Bearer ${token}` });
// 1x1 JPEG
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

describe('own profile', () => {
  test('name, phone, preferred language and photo can be changed', async () => {
    const p = await registerParent(stack.app);
    const res = await request(stack.app)
      .patch('/api/auth/me')
      .set(auth(p.token))
      .send({ name: 'Maria G.', phone: '+63 917 123 4567', language: 'fil', avatar: JPEG })
      .expect(200);
    expect(res.body.user).toMatchObject({
      name: 'Maria G.',
      phone: '+63 917 123 4567',
      language: 'fil',
    });
    expect(res.body.user.avatarUrl).toMatch(/^\/api\/auth\/avatar\/\w+\?v=\d+$/);

    const img = await request(stack.app).get(res.body.user.avatarUrl).expect(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.body[0]).toBe(0xff);

    const me = await request(stack.app).get('/api/auth/me').set(auth(p.token)).expect(200);
    expect(me.body.user.language).toBe('fil');

    const removed = await request(stack.app)
      .patch('/api/auth/me')
      .set(auth(p.token))
      .send({ avatar: null })
      .expect(200);
    expect(removed.body.user.avatarUrl).toBeNull();
  });

  test('bad input is refused', async () => {
    const p = await registerParent(stack.app);
    const send = (body) => request(stack.app).patch('/api/auth/me').set(auth(p.token)).send(body);
    await send({}).expect(400);
    await send({ name: '' }).expect(400);
    await send({ language: 'klingon' }).expect(400);
    await send({ phone: 'call me' }).expect(400);
    // claims to be a JPEG but is text
    await send({
      avatar: `data:image/jpeg;base64,${Buffer.from('hello world!').toString('base64')}`,
    }).expect(400);
    await request(stack.app).patch('/api/auth/me').send({ name: 'x' }).expect(401);
  });
});

describe('message language', () => {
  test("a message keeps the chosen language, else the sender's preferred one", async () => {
    const p = await registerParent(stack.app);
    const d = await createDriver(p.user.id);
    await request(stack.app)
      .patch('/api/auth/me')
      .set(auth(p.token))
      .send({ language: 'ceb' })
      .expect(200);
    const a = await request(stack.app)
      .post(`/api/drivers/${d._id}/messages`)
      .set(auth(p.token))
      .send({ text: 'Amping', kind: 'message' })
      .expect(201);
    expect(a.body.message.lang).toBe('ceb');
    const b = await request(stack.app)
      .post(`/api/drivers/${d._id}/messages`)
      .set(auth(p.token))
      .send({ text: '小心', lang: 'zh' })
      .expect(201);
    expect(b.body.message.lang).toBe('zh');
    expect(await Message.countDocuments({ lang: 'zh' })).toBe(1);
  });
});
