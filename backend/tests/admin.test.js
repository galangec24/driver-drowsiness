const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { env } = require('../src/config/env');
const User = require('../src/models/User');
const TrainingJob = require('../src/models/TrainingJob');
const ModelRelease = require('../src/models/ModelRelease');
const runner = require('../src/services/trainingRunner');
const fpVerifier = require('../src/services/fpVerifier');
const modelRegistry = require('../src/services/modelRegistry');
const { API_KEY, startStack, registerParent, createDriver, connectSocket } = require('./helpers');

const BUNDLED_VERIFIER = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../src/ml/fp-verifier.json'), 'utf8'),
);

let stack;
let tmp;
const saved = { ...env.ml };
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  Object.assign(env.ml, saved);
  runner._setStepBuilder(null);
  runner._setReleaseCollector(null);
  fpVerifier.loadModel();
  await stack.stop();
});
beforeEach(async () => {
  await stack.reset();
  modelRegistry.invalidate();
  // A throw-away ml/ folder; node stands in for Python so no real training runs.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-ml-'));
  Object.assign(env.ml, {
    mlDir: tmp,
    videosDir: path.join(tmp, 'videos'),
    python: process.execPath,
    monitorPython: process.execPath,
  });
  runner._setStepBuilder(null);
  runner._setReleaseCollector(null);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function admin() {
  const parent = await registerParent(stack.app);
  await User.updateOne({ _id: parent.user.id }, { role: 'admin' });
  return parent;
}

async function waitForJob(id, token) {
  for (let i = 0; i < 100; i += 1) {
    const res = await request(stack.app).get(`/api/admin/jobs/${id}`).set(auth(token));
    if (!['queued', 'running'].includes(res.body.job.status)) return res.body.job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('job did not finish');
}

describe('admin access', () => {
  test('parents get 403; admins get the overview', async () => {
    const parent = await registerParent(stack.app);
    await request(stack.app).get('/api/admin/overview').set(auth(parent.token)).expect(403);
    await request(stack.app).get('/api/admin/overview').expect(401);

    const a = await admin();
    const res = await request(stack.app).get('/api/admin/overview').set(auth(a.token)).expect(200);
    expect(res.body.counts).toMatchObject({ parents: 1, drivers: 0 });
    expect(res.body.models.fp_verifier.bundled).toBe(true);
    expect(res.body.worker.enabled).toBe(true);
  });

  test('ADMIN_EMAILS grants the role at registration / sign-in; the DB role is authoritative', async () => {
    const before = env.adminEmails;
    env.adminEmails = ['boss@example.com'];
    try {
      const reg = await request(stack.app)
        .post('/api/auth/register')
        .send({ name: 'Boss', email: 'boss@example.com', password: 'supersecret1' })
        .expect(201);
      expect(reg.body.user.role).toBe('admin');
      await request(stack.app).get('/api/admin/overview').set(auth(reg.body.token)).expect(200);
      // Revoking in the DB takes effect at once, even with the old token.
      env.adminEmails = [];
      await User.updateOne({ email: 'boss@example.com' }, { role: 'parent' });
      await request(stack.app).get('/api/admin/overview').set(auth(reg.body.token)).expect(403);
    } finally {
      env.adminEmails = before;
    }
  });
});

describe('datasets', () => {
  test('lists the public catalog with local status and feedback counts', async () => {
    const a = await admin();
    const res = await request(stack.app).get('/api/admin/datasets').set(auth(a.token)).expect(200);
    const ids = res.body.catalog.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['yawn-eye', 'mrl-eyes', 'yawn', 'uta-rldd']));
    expect(res.body.catalog.find((d) => d.id === 'mrl-eyes').local.ready).toBe(false);
    expect(res.body.catalog.find((d) => d.id === 'dmd')).toMatchObject({
      task: 'eye_state',
      source: 'manual',
      local: { ready: false, archives: 0, folder: path.join(tmp, 'videos', 'dmd') },
    });
    expect(res.body.feedback).toEqual({
      labelled: 0,
      falseAlarms: 0,
      realAlarms: 0,
      withWindow: 0,
    });
  });

  test('uploads a recording; rejects files that are not driver_monitor recordings', async () => {
    const a = await admin();
    const good = '{"t":0,"ear":0.3,"label":0}\n{"t":1,"ear":0.29,"label":0}\n';
    const res = await request(stack.app)
      .post('/api/admin/recordings')
      .set(auth(a.token))
      .send({ name: '../../evil name.jsonl', content: good })
      .expect(201);
    expect(res.body).toEqual({ file: 'evil-name.jsonl', rows: 2 });
    expect(fs.existsSync(path.join(tmp, 'data', 'raw', 'uploads', 'evil-name.jsonl'))).toBe(true);

    for (const content of ['not json\n', '{"ear":0.3}\n']) {
      await request(stack.app)
        .post('/api/admin/recordings')
        .set(auth(a.token))
        .send({ name: 'x', content })
        .expect(400);
    }
  });
});

describe('training jobs', () => {
  test('validation: unknown dataset, missing download, unsafe folder, worker off', async () => {
    const a = await admin();
    const post = (body) => request(stack.app).post('/api/admin/jobs').set(auth(a.token)).send(body);
    await post({ type: 'fetch_dataset', params: { datasetId: 'nope' } }).expect(400);
    await post({ type: 'fetch_dataset', params: { datasetId: 'uta-rldd' } }).expect(400); // video, not eyes
    await post({ type: 'train_eye_state', params: { datasets: ['mrl-eyes'] } }).expect(409);
    await post({ type: 'process_videos', params: { folder: '../etc', preset: 'rldd' } }).expect(
      400,
    );
    await post({ type: 'process_videos', params: { folder: 'uta-rldd', preset: 'rldd' } }).expect(
      409,
    );
    await post({ type: 'train_verifier', params: { recordings: ['ghost'] } }).expect(409);
    // DMD is processed from manually placed archives, never downloaded; other datasets can't be processed
    await post({ type: 'fetch_dataset', params: { datasetId: 'dmd' } }).expect(400);
    await post({ type: 'process_dmd', params: { datasetId: 'mrl-eyes' } }).expect(400);
    const noArchives = await post({ type: 'process_dmd', params: { datasetId: 'dmd' } }).expect(
      409,
    );
    expect(noArchives.body.error).toMatch(/dmd-dataset-drowsiness/);
    const notProcessed = await post({
      type: 'train_eye_state',
      params: { datasets: ['dmd'] },
    }).expect(409);
    expect(notProcessed.body.error).toMatch(/^Process "/);
    await post({ type: 'rm_rf', params: {} }).expect(400);

    env.ml.python = '';
    env.ml.mlDir = path.join(tmp, 'missing');
    await post({ type: 'train_verifier' }).expect(503);
  });

  test('runs steps, streams the log to admins, saves a candidate, and promotion makes it live', async () => {
    const a = await admin();
    runner._setStepBuilder(() => [
      { label: 'say hello', python: 'ml', args: ['-e', 'console.log("hello from the worker")'] },
      { label: 'in-process step', run: async (_ctx, log) => log('exported 0 labels\n') },
    ]);
    runner._setReleaseCollector((job) => ({
      kind: 'fp_verifier',
      artifact: { ...BUNDLED_VERIFIER, meta: { ...BUNDLED_VERIFIER.meta, note: `job ${job._id}` } },
      metrics: { test: 1 },
      report: '# report',
      summary: { falseAlertsPerHour: 0.1, episodeRecall: 1 },
    }));
    const socket = await connectSocket(stack.url, a.token);
    const lines = [];
    socket.on('training:log', (m) => lines.push(m.text));
    try {
      const created = await request(stack.app)
        .post('/api/admin/jobs')
        .set(auth(a.token))
        .send({ type: 'train_verifier' })
        .expect(201);
      const job = await waitForJob(created.body.job.id, a.token);
      expect(job.status).toBe('succeeded');
      expect(job.log).toContain('hello from the worker');
      expect(job.log).toContain('exported 0 labels');
      expect(lines.join('')).toContain('hello from the worker');
      expect(job.releaseId).toMatch(/^[a-f0-9]{24}$/);

      const models = await request(stack.app)
        .get('/api/admin/models')
        .set(auth(a.token))
        .expect(200);
      expect(models.body.releases[0]).toMatchObject({ kind: 'fp_verifier', status: 'candidate' });
      const detail = await request(stack.app)
        .get(`/api/admin/models/${job.releaseId}`)
        .set(auth(a.token))
        .expect(200);
      expect(detail.body.release.report).toBe('# report');

      await request(stack.app)
        .post(`/api/admin/models/${job.releaseId}/promote`)
        .set(auth(a.token))
        .expect(200);
      expect(fpVerifier.getModel().meta.note).toBe(`job ${created.body.job.id}`);

      await request(stack.app)
        .post('/api/admin/models/reset/fp_verifier')
        .set(auth(a.token))
        .expect(200);
      expect(fpVerifier.getModel().meta.note).not.toBe(`job ${created.body.job.id}`);
      expect((await ModelRelease.findById(job.releaseId)).status).toBe('retired');
    } finally {
      socket.close();
    }
  });

  test('process_dmd runs the DMD script on the placed archives with the monitor Python', async () => {
    const a = await admin();
    fs.mkdirSync(path.join(tmp, 'videos', 'dmd'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'videos', 'dmd', 'dmd-dataset-drowsiness-gA-1.tar.gz'), 'x');
    const ds = await request(stack.app).get('/api/admin/datasets').set(auth(a.token)).expect(200);
    expect(ds.body.catalog.find((d) => d.id === 'dmd').local.archives).toBe(1);

    const [step] = runner.buildSteps({
      _id: 'j',
      type: 'process_dmd',
      params: { datasetId: 'dmd' },
    });
    expect(step.python).toBe('monitor');
    expect(step.args).toEqual([
      'scripts/process_dmd.py',
      path.join(tmp, 'videos', 'dmd'),
      '--out',
      'data/eyes_dmd',
    ]);

    runner._setStepBuilder(() => [{ label: 'fake', python: 'monitor', args: ['-e', '0'] }]);
    const created = await request(stack.app)
      .post('/api/admin/jobs')
      .set(auth(a.token))
      .send({ type: 'process_dmd', params: { datasetId: 'dmd' } })
      .expect(201);
    expect((await waitForJob(created.body.job.id, a.token)).status).toBe('succeeded');
  });

  test('an eye model candidate carries the in-car (DMD) comparison with the live model', () => {
    const dir = path.join(tmp, 'data', 'candidates', 'abc');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'eye_state.json'), '{"kind":"logreg"}');
    fs.writeFileSync(
      path.join(dir, 'metrics.json'),
      JSON.stringify({
        test: { accuracy: 0.95, webcam_quality_accuracy: 0.93, roc_auc: 0.98 },
        kind: 'mlp',
        selected: 'hidden=64',
        datasets: ['data/eyes_v1', 'data/eyes_dmd'],
        test_by_dataset: [
          {
            dataset: 'data/eyes_v1',
            images: 200,
            candidate: { accuracy: 0.95 },
            live: { accuracy: 0.94 },
          },
          {
            dataset: 'data/eyes_dmd',
            images: 400,
            candidate: { accuracy: 0.9 },
            live: { accuracy: 0.7 },
          },
        ],
      }),
    );
    const release = runner.collectRelease({ _id: 'abc', type: 'train_eye_state' });
    expect(release.summary).toMatchObject({ inCarAccuracy: 0.9, inCarLiveAccuracy: 0.7 });
  });

  test('a failing step marks the job failed with the reason', async () => {
    const a = await admin();
    runner._setStepBuilder(() => [
      { label: 'boom', python: 'ml', args: ['-e', 'process.exit(3)'] },
    ]);
    const created = await request(stack.app)
      .post('/api/admin/jobs')
      .set(auth(a.token))
      .send({ type: 'import_uploads' })
      .expect(409); // nothing uploaded yet
    expect(created.body.error).toMatch(/Upload/);

    fs.mkdirSync(path.join(tmp, 'data', 'raw', 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'data', 'raw', 'uploads', 'a.jsonl'), '{"t":0}\n');
    const ok = await request(stack.app)
      .post('/api/admin/jobs')
      .set(auth(a.token))
      .send({ type: 'import_uploads' })
      .expect(201);
    const job = await waitForJob(ok.body.job.id, a.token);
    expect(job.status).toBe('failed');
    expect(job.error).toBe('exited with code 3');
  });

  test('a queued job can be cancelled; interrupted jobs are failed on restart', async () => {
    const a = await admin();
    const job = await TrainingJob.create({ type: 'import_uploads', params: {}, status: 'queued' });
    // Put a job "running" so the queued one stays queued.
    const stuck = await TrainingJob.create({
      type: 'train_verifier',
      params: {},
      status: 'running',
    });
    const res = await request(stack.app)
      .post(`/api/admin/jobs/${job._id}/cancel`)
      .set(auth(a.token))
      .expect(200);
    expect(res.body.job.status).toBe('cancelled');

    await runner.recover();
    expect((await TrainingJob.findById(stuck._id)).status).toBe('failed');
  });
});

describe('promoted models reach in-car devices', () => {
  test('eye-state model and yawn threshold are served with the ingest API key', async () => {
    const a = await admin();
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const url = `/api/ingest/drivers/${driver._id}/thresholds`;

    let res = await request(stack.app).get(url).set('x-api-key', API_KEY).expect(200);
    expect(res.body.device).toEqual({ yawnMar: null, eyeStateVersion: null });
    await request(stack.app)
      .get('/api/ingest/models/eye-state')
      .set('x-api-key', API_KEY)
      .expect(404);

    const eye = await ModelRelease.create({ kind: 'eye_state', artifact: { kind: 'mlp', w: [1] } });
    const yawn = await ModelRelease.create({ kind: 'yawn_threshold', artifact: { yawnMar: 0.46 } });
    for (const r of [eye, yawn]) {
      await request(stack.app)
        .post(`/api/admin/models/${r._id}/promote`)
        .set(auth(a.token))
        .expect(200);
    }
    res = await request(stack.app).get(url).set('x-api-key', API_KEY).expect(200);
    expect(res.body.device).toEqual({ yawnMar: 0.46, eyeStateVersion: eye._id.toString() });
    const model = await request(stack.app)
      .get('/api/ingest/models/eye-state')
      .set('x-api-key', API_KEY)
      .expect(200);
    expect(model.body).toEqual({ version: eye._id.toString(), model: { kind: 'mlp', w: [1] } });
    await request(stack.app).get('/api/ingest/models/eye-state').expect(401);
  });

  test('promoting an invalid verifier is refused and the live model is untouched', async () => {
    const a = await admin();
    const before = fpVerifier.getModel();
    const bad = await ModelRelease.create({ kind: 'fp_verifier', artifact: { kind: 'svm' } });
    const res = await request(stack.app)
      .post(`/api/admin/models/${bad._id}/promote`)
      .set(auth(a.token))
      .expect(400);
    expect(res.body.error).toMatch(/cannot be loaded/);
    expect(fpVerifier.getModel()).toBe(before);
  });
});

describe('several backends sharing one database', () => {
  test('a backend picks up a verifier promoted elsewhere within one sync', async () => {
    const release = await ModelRelease.create({
      kind: 'fp_verifier',
      status: 'active', // promoted by another backend instance
      artifact: {
        ...BUNDLED_VERIFIER,
        meta: { ...BUNDLED_VERIFIER.meta, note: 'from another instance' },
      },
    });
    expect(await modelRegistry.syncVerifier()).toBe(true);
    expect(fpVerifier.getModel().meta.note).toBe('from another instance');
    expect(await modelRegistry.syncVerifier()).toBe(false); // already in sync

    await ModelRelease.updateOne({ _id: release._id }, { status: 'retired' });
    expect(await modelRegistry.syncVerifier()).toBe(true);
    expect(fpVerifier.getModel().meta.note).not.toBe('from another instance');
  });
});
