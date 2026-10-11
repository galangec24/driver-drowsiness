const fs = require('fs');
const path = require('path');
const request = require('supertest');
const Driver = require('../src/models/Driver');
const { UPLOAD_DIR } = require('../src/services/mediaStorage');
const { loadFaceModels } = require('../src/config/faceApi');
const { startStack, registerParent, createDriver, fixtureBase64 } = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
  await loadFaceModels();
}, 120000);
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const photosOf = (p) => ['front', 'left', 'right'].map((a) => fixtureBase64(`person${p}_${a}.jpg`));
const created = [];
afterAll(() => {
  for (const id of created) fs.rmSync(path.join(UPLOAD_DIR, `${id}.jpg`), { force: true });
});

async function enroll(token, name, person, extra = {}) {
  const res = await request(stack.app)
    .post('/api/drivers')
    .set(auth(token))
    .send({ name, relationship: 'son', photos: photosOf(person), ...extra });
  if (res.body.driverId) created.push(res.body.driverId);
  return res;
}

describe('nameKeyOf', () => {
  test('ignores case, repeated/edge whitespace and Unicode width variants', () => {
    expect(Driver.nameKeyOf('  Juan   DELA\tCruz ')).toBe('juan dela cruz');
    expect(Driver.nameKeyOf('Ｍａｒｉａ')).toBe('maria');
    expect(Driver.nameKeyOf('Juan Dela Cruz Jr.')).not.toBe(Driver.nameKeyOf('Juan Dela Cruz'));
  });
});

describe('POST /api/drivers — one parent, many drivers, unique names', () => {
  test('a parent can register several drivers (twins with distinct names)', async () => {
    const parent = await registerParent(stack.app);
    expect((await enroll(parent.token, 'Juan Dela Cruz', 'A')).status).toBe(201);
    expect((await enroll(parent.token, 'Jose Dela Cruz', 'B')).status).toBe(201);

    const list = await request(stack.app).get('/api/drivers').set(auth(parent.token)).expect(200);
    expect(list.body.drivers.map((d) => d.name)).toEqual(['Juan Dela Cruz', 'Jose Dela Cruz']);
  });

  test('an identical name (any case/spacing) is rejected with 409 before face enrollment', async () => {
    const parent = await registerParent(stack.app);
    await createDriver(parent.user.id, {}, 'Juan Dela Cruz');

    // Photos are junk: the name check must fail first, without running the face model.
    const res = await request(stack.app)
      .post('/api/drivers')
      .set(auth(parent.token))
      .send({ name: '  juan   DELA cruz ', photos: ['x'.repeat(200)] })
      .expect(409);
    expect(res.body.error).toMatch(/already registered/);
    expect(res.body.error).toMatch(/twins/);
    expect(await Driver.countDocuments({ parentId: parent.user.id })).toBe(1);
  });

  test('a suffix makes the name distinct; other parents may reuse the name', async () => {
    const parent = await registerParent(stack.app);
    await createDriver(parent.user.id, {}, 'Juan Dela Cruz');
    expect((await enroll(parent.token, 'Juan Dela Cruz Jr.', 'A')).status).toBe(201);

    const other = await registerParent(stack.app);
    expect((await enroll(other.token, 'Juan Dela Cruz', 'B')).status).toBe(201);
  });

  test('the database enforces uniqueness even if the pre-check is bypassed (race)', async () => {
    const parent = await registerParent(stack.app);
    await Driver.syncIndexes();
    await createDriver(parent.user.id, {}, 'Maria Santos');
    await expect(createDriver(parent.user.id, {}, 'MARIA  santos')).rejects.toMatchObject({
      code: 11000,
    });
  });

  test('names must contain letters and be at least 2 characters', async () => {
    const parent = await registerParent(stack.app);
    for (const name of ['1', '1234', '  A ']) {
      await request(stack.app)
        .post('/api/drivers')
        .set(auth(parent.token))
        .send({ name, photos: ['x'.repeat(200)] })
        .expect(400);
    }
  });

  test('the same face under a new name is refused until the parent confirms a twin', async () => {
    const parent = await registerParent(stack.app);
    const first = await enroll(parent.token, 'Alex', 'A');
    expect(first.body.similarFaces).toEqual([]);

    // Duplicate identity: blocked, nothing created, the match is named so the app can ask.
    const dup = await enroll(parent.token, 'Alexa', 'A');
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/matches Alex/);
    expect(dup.body.details).toMatchObject({
      code: 'FACE_MATCHES_DRIVER',
      matches: [expect.objectContaining({ driverId: first.body.driverId, name: 'Alex' })],
    });
    expect(await Driver.countDocuments({ parentId: parent.user.id })).toBe(1);

    // "Yes, they are twins": registered, still flagged as a lookalike.
    const twin = await enroll(parent.token, 'Alexa', 'A', { confirmLookalike: true });
    expect(twin.status).toBe(201);
    expect(twin.body.similarFaces).toEqual([
      expect.objectContaining({ driverId: first.body.driverId, name: 'Alex' }),
    ]);

    const stranger = await enroll(parent.token, 'Sam', 'B');
    expect(stranger.status).toBe(201);
    expect(stranger.body.similarFaces).toEqual([]);
  });

  test('another family may register the same person (e.g. separated parents)', async () => {
    const a = await registerParent(stack.app);
    const b = await registerParent(stack.app);
    expect((await enroll(a.token, 'Alex', 'A')).status).toBe(201);
    expect((await enroll(b.token, 'Alex', 'A')).status).toBe(201);
  });
});

describe('POST /api/drivers/check-photo: each photo validated as it is taken', () => {
  const check = (token, body) =>
    request(stack.app).post('/api/drivers/check-photo').set(auth(token)).send(body);

  test('front photo: one face is accepted; a registered face is reported', async () => {
    const parent = await registerParent(stack.app);
    const ok = await check(parent.token, { photo: fixtureBase64('personA_front.jpg') }).expect(200);
    expect(ok.body).toMatchObject({ ok: true, problem: null, matches: [] });
    expect(ok.body.quality).toBeGreaterThan(0);

    const alex = await enroll(parent.token, 'Alex', 'A');
    const again = await check(parent.token, { photo: fixtureBase64('personA_front.jpg') }).expect(
      200,
    );
    expect(again.body.ok).toBe(true);
    expect(again.body.matches).toEqual([
      expect.objectContaining({ driverId: alex.body.driverId, name: 'Alex' }),
    ]);
    expect(JSON.stringify(again.body)).not.toMatch(/descriptor|faceEmbedding/);
  });

  test('side photos must be the same person as the front photo', async () => {
    const parent = await registerParent(stack.app);
    const front = fixtureBase64('personA_front.jpg');
    const same = await check(parent.token, {
      photo: fixtureBase64('personA_left.jpg'),
      front,
    }).expect(200);
    expect(same.body).toMatchObject({ ok: true });

    const other = await check(parent.token, {
      photo: fixtureBase64('personB_left.jpg'),
      front,
    }).expect(200);
    expect(other.body).toMatchObject({ ok: false, problem: 'different_person' });
    expect(other.body.message).toMatch(/same person/);
  });

  test('no face is rejected; parents only', async () => {
    const parent = await registerParent(stack.app);
    const { PNG } = require('pngjs');
    const blank = new PNG({ width: 200, height: 200 });
    blank.data.fill(180);
    const res = await check(parent.token, {
      photo: PNG.sync.write(blank).toString('base64'),
    }).expect(200);
    expect(res.body).toMatchObject({ ok: false, problem: 'no_face' });
    await request(stack.app)
      .post('/api/drivers/check-photo')
      .send({ photo: 'x'.repeat(200) })
      .expect(401);
  });
});
