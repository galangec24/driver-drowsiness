const fs = require('fs');
const path = require('path');
const request = require('supertest');
const Driver = require('../src/models/Driver');
const { UPLOAD_DIR } = require('../src/services/mediaStorage');
const { loadFaceModels } = require('../src/config/faceApi');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  fixtureBase64,
} = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
  await loadFaceModels();
}, 120000);
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const personA = ['front', 'left', 'right'].map((a) => fixtureBase64(`personA_${a}.jpg`));

describe('POST /api/drivers — 3-photo face enrollment', () => {
  let created = [];
  afterAll(() => {
    for (const id of created) fs.rmSync(path.join(UPLOAD_DIR, `${id}.jpg`), { force: true });
  });

  test('enrolls, stores the embedding server-side only, returns driverId', async () => {
    const parent = await registerParent(stack.app);
    const res = await request(stack.app)
      .post('/api/drivers')
      .set(auth(parent.token))
      .send({ name: 'Alex', relationship: 'daughter', photos: personA })
      .expect(201);
    created.push(res.body.driverId);

    expect(res.body.driverId).toMatch(/^[a-f0-9]{24}$/);
    expect(res.body.photos).toHaveLength(3);
    expect(res.body.quality).toBeGreaterThan(0);
    expect(res.body.driver).toMatchObject({
      name: 'Alex',
      relationship: 'daughter',
      faceEnrolled: true,
    });
    expect(res.body.driver.referencePhotoUrl).toMatch(/^\/uploads\/.+\.jpg$/);
    // Embeddings never reach the client.
    expect(JSON.stringify(res.body)).not.toContain('faceEmbedding');

    const stored = await Driver.findById(res.body.driverId).select('+faceEmbedding');
    expect(stored.faceEmbedding).toHaveLength(128);
    expect(stored.personalThresholds.earThreshold).toBe(0.21);

    const list = await request(stack.app).get('/api/drivers').set(auth(parent.token)).expect(200);
    expect(list.body.drivers).toHaveLength(1);
    expect(list.body.drivers[0].status).toBe('offline');
    expect(JSON.stringify(list.body)).not.toContain('faceEmbedding');

    await request(stack.app).get(res.body.driver.referencePhotoUrl).expect(200);
  });

  test('verify: same person matches, different person does not', async () => {
    const parent = await registerParent(stack.app);
    const res = await request(stack.app)
      .post('/api/drivers')
      .set(auth(parent.token))
      .send({ name: 'Alex', photos: personA })
      .expect(201);
    const id = res.body.driverId;
    created.push(id);

    const same = await request(stack.app)
      .post(`/api/drivers/${id}/verify`)
      .set(auth(parent.token))
      .send({ photo: fixtureBase64('personA_front.jpg') })
      .expect(200);
    expect(same.body.match).toBe(true);
    expect(same.body.confidence).toBeGreaterThan(0.5);

    const other = await request(stack.app)
      .post(`/api/drivers/${id}/verify`)
      .set(auth(parent.token))
      .send({ photo: fixtureBase64('personB_front.jpg') })
      .expect(200);
    expect(other.body.match).toBe(false);
    expect(other.body.confidence).toBeLessThan(same.body.confidence);
  });

  test('rejects photos of two different people', async () => {
    const parent = await registerParent(stack.app);
    const res = await request(stack.app)
      .post('/api/drivers')
      .set(auth(parent.token))
      .send({ name: 'Mixed', photos: [personA[0], fixtureBase64('personB_front.jpg')] })
      .expect(422);
    expect(res.body.error).toMatch(/same person/);
    expect(await Driver.countDocuments()).toBe(0);
  });

  test('rejects a photo with no face, and a missing photo', async () => {
    const parent = await registerParent(stack.app);
    const { PNG } = require('pngjs');
    const blank = new PNG({ width: 200, height: 200 });
    blank.data.fill(180);
    const blankB64 = PNG.sync.write(blank).toString('base64');
    const res = await request(stack.app)
      .post('/api/drivers')
      .set(auth(parent.token))
      .send({ name: 'Ghost', photos: [blankB64] })
      .expect(422);
    expect(res.body.error).toMatch(/No face/);

    await request(stack.app)
      .post('/api/drivers')
      .set(auth(parent.token))
      .send({ name: 'NoPhoto' })
      .expect(400);
  });
});

describe('driver details, thresholds and ownership', () => {
  test('PATCH thresholds changes fusion for subsequent ingests', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const signals = { ear: 0.12, perclos: 0.4, heartRate: 55 };

    const before = await request(stack.app)
      .post('/api/ingest')
      .set('x-api-key', API_KEY)
      .send(ingestPayload(driver._id, signals))
      .expect(200);

    const patch = await request(stack.app)
      .patch(`/api/drivers/${driver._id}/thresholds`)
      .set(auth(parent.token))
      .send({ earThreshold: 0.12, perclosThreshold: 0.9 })
      .expect(200);
    expect(patch.body.driver.personalThresholds).toMatchObject({
      earThreshold: 0.12,
      perclosThreshold: 0.9,
      fusionWeightVision: 0.6,
    });

    const after = await request(stack.app)
      .post('/api/ingest')
      .set('x-api-key', API_KEY)
      .send(ingestPayload(driver._id, signals))
      .expect(200);
    expect(before.body.classification).toBe('warning');
    expect(after.body.classification).toBe('alert');

    const detail = await request(stack.app)
      .get(`/api/drivers/${driver._id}`)
      .set(auth(parent.token))
      .expect(200);
    expect(detail.body.driver.status).toBe('alert');

    const logs = await request(stack.app)
      .get(`/api/drivers/${driver._id}/logs?limit=10`)
      .set(auth(parent.token))
      .expect(200);
    expect(logs.body.logs).toHaveLength(2);
    expect(logs.body.logs[0].signals.ear).toBe(0.12);
  });

  test('threshold validation rejects out-of-range values and empty bodies', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const url = `/api/drivers/${driver._id}/thresholds`;
    await request(stack.app)
      .patch(url)
      .set(auth(parent.token))
      .send({ earThreshold: 5 })
      .expect(400);
    await request(stack.app).patch(url).set(auth(parent.token)).send({}).expect(400);
  });

  test('another parent cannot read, tune, or delete the driver', async () => {
    const owner = await registerParent(stack.app);
    const driver = await createDriver(owner.user.id);
    const intruder = await registerParent(stack.app);
    await request(stack.app)
      .get(`/api/drivers/${driver._id}`)
      .set(auth(intruder.token))
      .expect(404);
    await request(stack.app)
      .patch(`/api/drivers/${driver._id}/thresholds`)
      .set(auth(intruder.token))
      .send({ earThreshold: 0.2 })
      .expect(404);
    await request(stack.app)
      .delete(`/api/drivers/${driver._id}`)
      .set(auth(intruder.token))
      .expect(404);
    await request(stack.app)
      .delete(`/api/drivers/${driver._id}`)
      .set(auth(owner.token))
      .expect(204);
    expect(await Driver.countDocuments()).toBe(0);
  });
});
