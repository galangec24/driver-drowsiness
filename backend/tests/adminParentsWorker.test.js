const os = require('os');
const path = require('path');
const request = require('supertest');
const { env } = require('../src/config/env');
const User = require('../src/models/User');
const TrainingJob = require('../src/models/TrainingJob');
const WorkerStatus = require('../src/models/WorkerStatus');
const runner = require('../src/services/trainingRunner');
const { API_KEY, startStack, registerParent, createDriver, ingestPayload } = require('./helpers');

let stack;
const saved = { ...env.ml };
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  Object.assign(env.ml, saved);
  await stack.stop();
});
beforeEach(async () => {
  await stack.reset();
  // This "API server" has no Python, like Render.
  const nowhere = path.join(os.tmpdir(), `gd-no-ml-${Date.now()}`);
  Object.assign(env.ml, { mlDir: nowhere, monitorDir: nowhere, python: '', monitorPython: '' });
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function admin() {
  const a = await registerParent(stack.app, { name: 'Admin' });
  await User.updateOne({ _id: a.user.id }, { role: 'admin' });
  return a;
}

function heartbeat(ageMs = 0, info = {}) {
  return WorkerStatus.create({
    _id: 'emman-laptop',
    host: 'EMMAN-LAPTOP',
    info: {
      enabled: true,
      mlPython: 'C:/ml/python.exe',
      monitorPython: 'C:/dm/python.exe',
      problems: [],
      ...info,
    },
    datasets: {
      catalog: [{ id: 'yawn-eye', task: 'eye_state', local: { ready: true, images: 4000 } }],
      recordings: [],
    },
    lastSeen: new Date(Date.now() - ageMs),
  });
}

describe('admin parents list', () => {
  test('lists every account with its drivers, online count and alert activity', async () => {
    const a = await admin();
    const pat = await registerParent(stack.app, { name: 'Pat' });
    const sam = await registerParent(stack.app, { name: 'Sam' });
    const d1 = await createDriver(pat.user.id, {}, 'Ana');
    await createDriver(pat.user.id, {}, 'Ben');
    // Ana's car is sending data right now
    await request(stack.app)
      .post('/api/ingest')
      .set('x-api-key', API_KEY)
      .send(ingestPayload(d1._id.toString()))
      .expect(200);

    const res = await request(stack.app).get('/api/admin/parents').set(auth(a.token)).expect(200);
    const byName = Object.fromEntries(res.body.parents.map((p) => [p.name, p]));
    expect(byName.Pat).toMatchObject({
      driverCount: 2,
      onlineDrivers: 1,
      signIn: 'password',
      emailVerified: true,
    });
    expect(byName.Pat.drivers.map((d) => [d.name, d.online])).toEqual([
      ['Ana', true],
      ['Ben', false],
    ]);
    expect(byName.Sam).toMatchObject({ driverCount: 0, alertsTotal: 0 });
    expect(byName.Admin.role).toBe('admin');
    expect(res.body.totals).toMatchObject({
      accounts: 3,
      parents: 2,
      drivers: 2,
      onlineDrivers: 1,
    });
    // never leaks secrets
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|googleId|faceEmbedding/);

    await request(stack.app).get('/api/admin/parents').set(auth(sam.token)).expect(403);
  });
});

describe('training on a remote worker (API without Python)', () => {
  test('without a worker online, jobs are refused with how to start one', async () => {
    const a = await admin();
    const res = await request(stack.app)
      .post('/api/admin/jobs')
      .set(auth(a.token))
      .send({ type: 'train_verifier', params: {} })
      .expect(503);
    expect(res.body.error).toMatch(/npm run worker/);
    // a stale heartbeat doesn't count
    await heartbeat(runner.HEARTBEAT_FRESH_MS + 5000);
    await request(stack.app)
      .post('/api/admin/jobs')
      .set(auth(a.token))
      .send({ type: 'train_verifier' })
      .expect(503);
  });

  test('with a fresh heartbeat the job is queued for the laptop, not run here', async () => {
    const a = await admin();
    await heartbeat();
    const ov = await request(stack.app).get('/api/admin/overview').set(auth(a.token)).expect(200);
    expect(ov.body.worker).toMatchObject({ enabled: true, mode: 'remote', host: 'EMMAN-LAPTOP' });

    const ds = await request(stack.app).get('/api/admin/datasets').set(auth(a.token)).expect(200);
    expect(ds.body.catalog[0].local.images).toBe(4000); // the laptop's files
    expect(ds.body.feedback).toBeDefined();

    const created = await request(stack.app)
      .post('/api/admin/jobs')
      .set(auth(a.token))
      .send({ type: 'train_eye_state', params: { datasets: ['yawn-eye'] } })
      .expect(201);
    await runner.kick();
    const job = await TrainingJob.findById(created.body.job.id);
    expect(job.status).toBe('queued'); // this server can't train, so it never claims it
  });

  test('cancelling a job running on the laptop flags it; restarts leave it alone', async () => {
    const a = await admin();
    await heartbeat();
    const job = await TrainingJob.create({
      type: 'train_verifier',
      status: 'running',
      worker: 'emman-laptop',
      startedAt: new Date(),
    });
    await runner.recover();
    expect((await TrainingJob.findById(job._id)).status).toBe('running');

    await request(stack.app)
      .post(`/api/admin/jobs/${job._id}/cancel`)
      .set(auth(a.token))
      .expect(200);
    expect((await TrainingJob.findById(job._id)).cancelRequested).toBe(true);
    const list = await request(stack.app).get('/api/admin/jobs').set(auth(a.token)).expect(200);
    expect(list.body.busy).toBe(true);
  });
});
