const fs = require('fs');
const path = require('path');
const request = require('supertest');
const User = require('../src/models/User');
const Feedback = require('../src/models/Feedback');
const { UPLOAD_DIR } = require('../src/services/mediaStorage');
const { detectType } = require('../src/services/feedbackFiles');
const { startStack, registerParent, fixtureBase64 } = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  fs.rmSync(path.join(UPLOAD_DIR, 'feedback'), { recursive: true, force: true });
  await stack.stop();
});
beforeEach(async () => stack.reset());

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const send = (token, body) => request(stack.app).post('/api/feedback').set(auth(token)).send(body);
const b64 = (s) => Buffer.from(s).toString('base64');

async function admin() {
  const a = await registerParent(stack.app, { name: 'Admin' });
  await User.updateOne({ _id: a.user.id }, { role: 'admin' });
  return a;
}

describe('feedback', () => {
  test('a parent sends feedback with a screenshot and a log file; the admin sees it', async () => {
    const pat = await registerParent(stack.app, { name: 'Pat' });
    const res = await send(pat.token, {
      category: 'bug',
      message: 'The map does not move when the car moves.',
      attachments: [
        {
          name: 'screenshot.jpg',
          data: fixtureBase64('personA_front.jpg'),
        },
        { name: 'console.log', data: b64('TypeError: x is undefined\nat Map3D') },
      ],
      page: '/drivers/abc',
      platform: 'web',
      appVersion: '1.0.6',
    }).expect(201);

    const fb = res.body.feedback;
    expect(fb).toMatchObject({ category: 'bug', status: 'new', userName: 'Pat' });
    expect(fb.context).toMatchObject({
      page: '/drivers/abc',
      platform: 'web',
      appVersion: '1.0.6',
    });
    expect(fb.attachments.map((a) => [a.name, a.mime])).toEqual([
      ['screenshot.jpg', 'image/jpeg'],
      ['console.txt', 'text/plain'],
    ]);
    // stored and downloadable
    await request(stack.app).get(fb.attachments[0].url).expect(200);

    const a = await admin();
    const list = await request(stack.app).get('/api/admin/feedback').set(auth(a.token)).expect(200);
    expect(list.body.feedback).toHaveLength(1);
    expect(list.body.counts).toEqual({ new: 1, in_progress: 0, resolved: 0 });
    await request(stack.app).get('/api/admin/feedback').set(auth(pat.token)).expect(403);
  });

  test('the admin replies and resolves; the parent sees the reply in "my feedback"', async () => {
    const pat = await registerParent(stack.app);
    const sent = await send(pat.token, {
      category: 'question',
      message: 'How do I add a second driver?',
    }).expect(201);
    const a = await admin();
    const id = sent.body.feedback.id;
    const replied = await request(stack.app)
      .patch(`/api/admin/feedback/${id}`)
      .set(auth(a.token))
      .send({ reply: 'Drivers → Register driver, then take 3 photos.' })
      .expect(200);
    expect(replied.body.feedback).toMatchObject({
      status: 'in_progress',
      adminReply: expect.stringMatching(/Register/),
    });

    await request(stack.app)
      .patch(`/api/admin/feedback/${id}`)
      .set(auth(a.token))
      .send({ status: 'resolved' })
      .expect(200);
    const mine = await request(stack.app)
      .get('/api/feedback/mine')
      .set(auth(pat.token))
      .expect(200);
    expect(mine.body.feedback[0]).toMatchObject({
      status: 'resolved',
      adminReply: expect.any(String),
    });

    // other users never see it
    const other = await registerParent(stack.app);
    const theirs = await request(stack.app)
      .get('/api/feedback/mine')
      .set(auth(other.token))
      .expect(200);
    expect(theirs.body.feedback).toEqual([]);
  });

  test('rejects disguised or oversized files, too many files, and empty messages', async () => {
    const pat = await registerParent(stack.app);
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 0)]).toString('base64');
    await send(pat.token, {
      message: 'look',
      attachments: [{ name: 'photo.png', data: exe }],
    }).expect(415);
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 0x41).toString('base64');
    await send(pat.token, { message: 'big', attachments: [{ name: 'a.txt', data: big }] }).expect(
      413,
    );
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `${i}.txt`, data: b64('hello') }));
    await send(pat.token, { message: 'many', attachments: five }).expect(400);
    await send(pat.token, { message: ' ' }).expect(400);
    await request(stack.app).post('/api/feedback').send({ message: 'no login' }).expect(401);
    expect(await Feedback.countDocuments()).toBe(0);
  });

  test('file types come from the content, not the name', () => {
    expect(detectType(Buffer.from('%PDF-1.7 ...'))).toMatchObject({ mime: 'application/pdf' });
    expect(
      detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toMatchObject({
      mime: 'image/png',
    });
    expect(detectType(Buffer.from('plain log line\n'))).toMatchObject({ mime: 'text/plain' });
    expect(detectType(Buffer.from([0x4d, 0x5a, 0x00, 0x01]))).toBeNull();
  });
});
