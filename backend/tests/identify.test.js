const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jpeg = require('jpeg-js');
const { UPLOAD_DIR } = require('../src/services/mediaStorage');
const { loadFaceModels } = require('../src/config/faceApi');
const { pickDriver } = require('../src/services/driverIdentifier');
const { API_KEY, startStack, registerParent, createDriver, fixtureBase64 } = require('./helpers');

let stack;
const created = [];
beforeAll(async () => {
  stack = await startStack();
  await loadFaceModels();
}, 120000);
afterAll(async () => {
  for (const id of created) fs.rmSync(path.join(UPLOAD_DIR, `${id}.jpg`), { force: true });
  await stack.stop();
});
beforeEach(async () => stack.reset());

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const photos = (who) =>
  ['front', 'left', 'right'].map((a) => fixtureBase64(`person${who}_${a}.jpg`));
const identify = (body) =>
  request(stack.app).post('/api/ingest/identify').set('x-api-key', API_KEY).send(body);

async function enroll(parent, name, who) {
  const res = await request(stack.app)
    .post('/api/drivers')
    .set(auth(parent.token))
    .send({ name, relationship: 'child', photos: photos(who) })
    .expect(201);
  created.push(res.body.driverId);
  return res.body.driverId;
}

function blankJpeg() {
  const width = 160;
  const height = 120;
  const data = Buffer.alloc(width * height * 4, 128);
  return jpeg.encode({ data, width, height }, 80).data.toString('base64');
}

describe('POST /api/ingest/identify: who is in the driver seat?', () => {
  test('recognises each enrolled driver of the family from a camera frame', async () => {
    const family = await registerParent(stack.app, { email: 'cruz.family@example.com' });
    const ana = await enroll(family, 'Ana', 'A');
    const ben = await enroll(family, 'Ben', 'B');

    const a = await identify({
      family: 'Cruz.Family@example.com',
      image: fixtureBase64('personA_front.jpg'),
    }).expect(200);
    expect(a.body).toMatchObject({ driverId: ana, name: 'Ana', drivers: 2 });
    expect(a.body.confidence).toBeGreaterThan(0.5);

    const b = await identify({
      family: 'cruz.family@example.com',
      image: fixtureBase64('personB_left.jpg'),
    }).expect(200);
    expect(b.body).toMatchObject({ driverId: ben, name: 'Ben' });
  });

  test('only compares with that family: a stranger is "unknown"', async () => {
    const family = await registerParent(stack.app, { email: 'reyes@example.com' });
    await enroll(family, 'Ana', 'A');
    const other = await registerParent(stack.app, { email: 'other@example.com' });
    await enroll(other, 'Ben', 'B');

    const res = await identify({
      family: 'reyes@example.com',
      image: fixtureBase64('personB_front.jpg'),
    }).expect(200);
    expect(res.body).toMatchObject({ driverId: null, reason: 'unknown' });
  });

  test('a frame without a face, unknown family, and no enrolled drivers', async () => {
    const family = await registerParent(stack.app, { email: 'santos@example.com' });
    await identify({
      family: 'santos@example.com',
      image: fixtureBase64('personA_front.jpg'),
    }).expect(409);
    await createDriver(family.user.id); // no face photos
    await identify({
      family: 'santos@example.com',
      image: fixtureBase64('personA_front.jpg'),
    }).expect(409);
    await enroll(family, 'Ana', 'A');

    const empty = await identify({ family: 'santos@example.com', image: blankJpeg() }).expect(200);
    expect(empty.body).toMatchObject({ driverId: null, reason: 'no_face' });
    await identify({ family: 'nobody@example.com', image: blankJpeg() }).expect(404);
    await request(stack.app)
      .post('/api/ingest/identify')
      .send({ family: 'santos@example.com', image: blankJpeg() })
      .expect(401);
  });
});

describe('two registered family members in the same car', () => {
  test('the face closest to the camera is the driver; the other is reported as a passenger', async () => {
    const family = await registerParent(stack.app, { email: 'twokids@example.com' });
    const ana = await enroll(family, 'Ana', 'A');
    const ben = await enroll(family, 'Ben', 'B');

    const res = await identify({
      family: 'twokids@example.com',
      image: fixtureBase64('two_faces.jpg'),
    }).expect(200);
    expect(res.body).toMatchObject({ driverId: ana, name: 'Ana', faces: 2 });
    expect(res.body.passengers).toEqual([{ driverId: ben, name: 'Ben' }]);
  });

  test('a registered child as passenger next to an unknown driver is not taken for the driver', async () => {
    const family = await registerParent(stack.app, { email: 'passenger@example.com' });
    const ben = await enroll(family, 'Ben', 'B');
    const res = await identify({
      family: 'passenger@example.com',
      image: fixtureBase64('two_faces.jpg'),
    }).expect(200);
    expect(res.body).toMatchObject({ driverId: null, reason: 'unknown' });
    expect(res.body.passengers).toEqual([{ driverId: ben, name: 'Ben' }]);
  });
});

describe('pickDriver', () => {
  const vec = (x) => Array.from({ length: 128 }, (_, i) => (i === 0 ? x : 0));
  const drivers = [
    { _id: 'a', name: 'Ana', faceEmbedding: vec(0) },
    { _id: 'b', name: 'Bea', faceEmbedding: vec(1) },
  ];

  test('closest enrolled face within the match distance wins', () => {
    expect(pickDriver(drivers, vec(0.1))).toMatchObject({ driverId: 'a', name: 'Ana' });
    expect(pickDriver(drivers, vec(0.95))).toMatchObject({ driverId: 'b' });
    expect(pickDriver(drivers, vec(5))).toMatchObject({ driverId: null, reason: 'unknown' });
  });

  test('look-alikes (e.g. twins) too close to call are "ambiguous", not a guess', () => {
    const twins = [
      { _id: 'a', name: 'Ana', faceEmbedding: vec(0) },
      { _id: 'b', name: 'Bea', faceEmbedding: vec(0.05) },
    ];
    expect(pickDriver(twins, vec(0.02))).toMatchObject({
      driverId: null,
      reason: 'ambiguous',
      candidates: ['Ana', 'Bea'],
    });
  });
});
