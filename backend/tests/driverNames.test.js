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

async function enroll(token, name, person) {
  const res = await request(stack.app)
    .post('/api/drivers')
    .set(auth(token))
    .send({ name, relationship: 'son', photos: photosOf(person) });
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

  test('enrolling the same face under a new name reports the lookalike (twins notice)', async () => {
    const parent = await registerParent(stack.app);
    const first = await enroll(parent.token, 'Alex', 'A');
    expect(first.body.similarFaces).toEqual([]);

    const twin = await enroll(parent.token, 'Alexa', 'A');
    expect(twin.status).toBe(201);
    expect(twin.body.similarFaces).toEqual([
      expect.objectContaining({ driverId: first.body.driverId, name: 'Alex' }),
    ]);

    const stranger = await enroll(parent.token, 'Sam', 'B');
    expect(stranger.body.similarFaces).toEqual([]);
  });
});
