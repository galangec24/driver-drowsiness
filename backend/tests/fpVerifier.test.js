const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { computeFeatures, FEATURE_NAMES, MIN_TICKS } = require('../src/services/fpFeatures');
const fpVerifier = require('../src/services/fpVerifier');
const { computeDrowsinessScore } = require('../src/services/fusionEngine');
const signalWindow = require('../src/services/signalWindow');
const ingestService = require('../src/services/ingestService');
const Alert = require('../src/models/Alert');
const SensorLog = require('../src/models/SensorLog');
const { startStack, registerParent, createDriver } = require('./helpers');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/fp-parity.json'), 'utf8'),
);
const model = JSON.parse(fs.readFileSync(fpVerifier.DEFAULT_MODEL_PATH, 'utf8'));

describe('Python ↔ JS parity (fixtures from ml/scripts/train.py)', () => {
  test('feature vectors match the canonical Python implementation', () => {
    expect(fixture.verifier.length).toBeGreaterThan(50);
    for (const c of fixture.verifier) {
      const js = computeFeatures(c.window, c.thresholds);
      expect(js).toHaveLength(FEATURE_NAMES.length);
      js.forEach((v, i) => expect(Math.abs(v - c.features[i])).toBeLessThan(1e-12));
    }
  });

  test('verifier probabilities match scikit-learn', () => {
    for (const c of fixture.verifier) {
      expect(Math.abs(fpVerifier.predict(c.features, model) - c.probability)).toBeLessThan(1e-9);
    }
  });

  test('fusion engine matches the Python port used to build training data', () => {
    for (const c of fixture.fusion) {
      const r = computeDrowsinessScore(c.signals, { personalThresholds: c.thresholds });
      expect(Math.abs(r.fusionScore - c.fusionScore)).toBeLessThan(1e-12);
      expect(r.classification).toBe(c.classification);
    }
  });
});

describe('fpVerifier unit', () => {
  const stump = {
    kind: 'gradient_boosted_trees',
    version: 0,
    features: FEATURE_NAMES,
    threshold: 0.5,
    init: 0,
    learningRate: 1,
    // one split on feature 7 (frac_below): <= 0.5 → -2, else +2
    trees: [{ f: [7, -2, -2], t: [0.5, -2, -2], l: [1, -1, -1], r: [2, -1, -1], v: [0, -2, 2] }],
  };

  test('evaluates trees with float32 comparisons and a sigmoid', () => {
    const x = new Array(FEATURE_NAMES.length).fill(0);
    expect(fpVerifier.predict(x, stump)).toBeCloseTo(1 / (1 + Math.exp(2)), 12);
    x[7] = 0.9;
    expect(fpVerifier.predict(x, stump)).toBeCloseTo(1 / (1 + Math.exp(-2)), 12);
  });

  test('rejects a model whose feature list differs from fpFeatures.js', () => {
    expect(() => fpVerifier.setModel({ ...stump, features: ['x'] })).toThrow(/feature list/);
    expect(() => fpVerifier.setModel({ ...stump, kind: 'nn' })).toThrow(/unsupported/);
  });

  test('returns null with no model', () => {
    fpVerifier.setModel(null);
    expect(fpVerifier.predict([1, 2, 3])).toBeNull();
  });

  test('missing EAR falls back to neutral defaults', () => {
    const f = computeFeatures([{ fusionScore: 0.5 }, { fusionScore: 0.8, heartRate: 0 }], {
      earThreshold: 0.21,
      perclosThreshold: 0.4,
    });
    expect(f.slice(0, 8)).toEqual([2, 1, 1, 1, 0, 0, 0, 0]);
    expect(f[FEATURE_NAMES.indexOf('missing_ear_frac')]).toBe(1);
    expect(f[FEATURE_NAMES.indexOf('frac_drowsy')]).toBe(0.5);
  });
});

describe('ingest with the verifier', () => {
  let stack;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => stack.stop());
  beforeEach(async () => {
    await stack.reset();
    fpVerifier.setModel(model);
  });
  afterEach(() => fpVerifier.setModel(null));

  /** Replay a fixture window: seed history, then send its last tick through the real ingest path. */
  async function replay(c) {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id, c.thresholds);
    const id = driver._id.toString();
    const base = Date.now() - c.window.length * 1000;
    c.window
      .slice(0, -1)
      .forEach((tick, i) => signalWindow.push(id, { ...tick, t: base + i * 1000 }));
    const last = c.window[c.window.length - 1];
    const signals = {};
    for (const k of ['ear', 'perclos', 'heartRate', 'faceConfidence']) {
      if (last[k] !== null && last[k] !== undefined) signals[k] = last[k];
    }
    return {
      parent,
      result: await ingestService.processIngest(driver, { signals, source: 'simulated' }),
    };
  }

  const fullWindow = (c) => c.window.length >= MIN_TICKS;

  test('suppresses a candidate alert the model scores below threshold', async () => {
    const c = fixture.verifier.find((x) => fullWindow(x) && x.probability < model.threshold - 0.05);
    if (!c) return; // model separates every fixture case — nothing to suppress
    const { result } = await replay(c);
    expect(result.classification).not.toBe('alert');
    expect(result.alertTriggered).toBe(false);
    expect(await Alert.countDocuments()).toBe(0);
    const log = await SensorLog.findOne().sort({ createdAt: -1 });
    expect(log.verifierScore).toBeCloseTo(c.probability, 3);
  });

  test('allows a candidate the model confirms, storing the evidence server-side only', async () => {
    const c = fixture.verifier.find(
      (x) => fullWindow(x) && x.probability > model.threshold + 0.005,
    );
    expect(c).toBeDefined();
    const { parent, result } = await replay(c);
    expect(result.alertTriggered).toBe(true);
    const stored = await Alert.findById(result.alertId).select('+verifier');
    expect(stored.verifier.score).toBeCloseTo(c.probability, 3);
    expect(stored.verifier.window).toHaveLength(c.window.length);

    const res = await request(stack.app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${parent.token}`)
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain('verifier');
  });

  test('abstains (fusion-only behaviour) with less than MIN_TICKS of history', async () => {
    const c = fixture.verifier.find((x) => x.probability < model.threshold) || fixture.verifier[0];
    const short = { ...c, window: c.window.slice(-3) };
    const { result } = await replay(short);
    if (result.classification !== 'alert') expect(result.alertTriggered).toBe(true);
  });
});
