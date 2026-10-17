const {
  computeDrowsinessScore,
  classify,
  resolveThresholds,
  DEFAULT_THRESHOLDS,
} = require('./fusionEngine');

const defaultDriver = { personalThresholds: { ...DEFAULT_THRESHOLDS } };

describe('fusionEngine.classify — band boundaries', () => {
  test('exactly 0.40 is "alert" (bands are strictly greater-than)', () => {
    expect(classify(0.4)).toBe('alert');
  });

  test('just above 0.40 is "warning"', () => {
    expect(classify(0.4000001)).toBe('warning');
  });

  test('exactly 0.70 is "warning"', () => {
    expect(classify(0.7)).toBe('warning');
  });

  test('just above 0.70 is "drowsy"', () => {
    expect(classify(0.7000001)).toBe('drowsy');
  });
});

describe('fusionEngine.computeDrowsinessScore — boundaries via real signals', () => {
  test('fused score of exactly 0.40 classifies as alert', () => {
    // vision = 0 (ear at threshold, perclos 0), physio = 1 (HR 45) → 0.4 * 1 = 0.40
    const r = computeDrowsinessScore({ ear: 0.21, perclos: 0, heartRate: 45 }, defaultDriver);
    expect(r.fusionScore).toBeCloseTo(0.4, 10);
    expect(r.fusionScore).toBe(0.4);
    expect(r.classification).toBe('alert');
  });

  test('fused score of exactly 0.70 classifies as warning', () => {
    const driver = {
      personalThresholds: { ...DEFAULT_THRESHOLDS, fusionWeightVision: 0.7, fusionWeightPhysio: 0 },
    };
    // vision fully saturated: ear 0 → 1, perclos ≥ threshold → 1 → 0.7 * (0.6 + 0.4) = 0.70
    const r = computeDrowsinessScore({ ear: 0, perclos: 1, heartRate: 80 }, driver);
    expect(r.fusionScore).toBe(0.7);
    expect(r.classification).toBe('warning');
  });
});

describe('fusionEngine.computeDrowsinessScore — all three bands', () => {
  test('alert: eyes open, low PERCLOS, normal HR', () => {
    const r = computeDrowsinessScore({ ear: 0.3, perclos: 0.05, heartRate: 75 }, defaultDriver);
    expect(r.classification).toBe('alert');
    expect(r.fusionScore).toBeLessThanOrEqual(0.4);
  });

  test('warning: moderate eye closure', () => {
    const r = computeDrowsinessScore({ ear: 0.15, perclos: 0.35, heartRate: 52 }, defaultDriver);
    expect(r.classification).toBe('warning');
    expect(r.fusionScore).toBeGreaterThan(0.4);
    expect(r.fusionScore).toBeLessThanOrEqual(0.7);
  });

  test('drowsy: eyes mostly closed, high PERCLOS, low HR', () => {
    const r = computeDrowsinessScore({ ear: 0.08, perclos: 0.6, heartRate: 48 }, defaultDriver);
    expect(r.classification).toBe('drowsy');
    expect(r.fusionScore).toBeGreaterThan(0.7);
  });

  test('score is continuous and always within 0..1', () => {
    const r = computeDrowsinessScore({ ear: -5, perclos: 99, heartRate: 1 }, defaultDriver);
    expect(r.fusionScore).toBeGreaterThanOrEqual(0);
    expect(r.fusionScore).toBeLessThanOrEqual(1);
  });
});

describe('fusionEngine.computeDrowsinessScore — missing signals never throw', () => {
  test.each([
    ['empty signals', {}],
    ['undefined signals', undefined],
    ['null signals', null],
    ['only ear', { ear: 0.1 }],
    ['only heartRate', { heartRate: 50 }],
    ['non-numeric values', { ear: 'x', perclos: null, heartRate: NaN }],
  ])('%s', (_label, signals) => {
    expect(() => computeDrowsinessScore(signals, defaultDriver)).not.toThrow();
    const r = computeDrowsinessScore(signals, defaultDriver);
    expect(Number.isFinite(r.fusionScore)).toBe(true);
    expect(['alert', 'warning', 'drowsy']).toContain(r.classification);
  });

  test('missing driver thresholds fall back to defaults', () => {
    expect(() => computeDrowsinessScore({ ear: 0.1 }, {})).not.toThrow();
    expect(() => computeDrowsinessScore({ ear: 0.1 }, null)).not.toThrow();
    expect(resolveThresholds(null)).toEqual(DEFAULT_THRESHOLDS);
  });

  test('heartRate 0 means "no sensor" and adds no physio evidence', () => {
    const r = computeDrowsinessScore({ ear: 0.3, perclos: 0, heartRate: 0 }, defaultDriver);
    expect(r.components.physioScore).toBe(0);
  });
});

describe('fusionEngine.computeDrowsinessScore — per-driver adaptive thresholds', () => {
  const signals = { ear: 0.19, perclos: 0.3, heartRate: 70 };

  test('same signals → different outcomes for different drivers', () => {
    // A driver with naturally narrow eyes has a low personal EAR threshold.
    const narrowEyed = {
      personalThresholds: { ...DEFAULT_THRESHOLDS, earThreshold: 0.15, perclosThreshold: 0.6 },
    };
    // A sensitive profile: high EAR threshold, low PERCLOS tolerance, vision-heavy weights.
    const sensitive = {
      personalThresholds: {
        ...DEFAULT_THRESHOLDS,
        earThreshold: 0.3,
        perclosThreshold: 0.25,
        fusionWeightVision: 0.9,
        fusionWeightPhysio: 0.1,
      },
    };

    const a = computeDrowsinessScore(signals, narrowEyed);
    const b = computeDrowsinessScore(signals, sensitive);

    expect(a.fusionScore).not.toBeCloseTo(b.fusionScore, 3);
    expect(a.classification).toBe('alert');
    expect(b.classification).toBe('warning');
  });

  test('fusion weights change the result', () => {
    const s = { ear: 0.3, perclos: 0, heartRate: 45 };
    const physioHeavy = {
      personalThresholds: {
        ...DEFAULT_THRESHOLDS,
        fusionWeightVision: 0.2,
        fusionWeightPhysio: 0.8,
      },
    };
    expect(computeDrowsinessScore(s, defaultDriver).classification).toBe('alert');
    expect(computeDrowsinessScore(s, physioHeavy).classification).toBe('drowsy');
  });
});

describe('fusionEngine — narrow eyes (live open-eye baseline from the camera)', () => {
  test('open narrow eyes are not evidence of drowsiness when the baseline is sent', () => {
    const s = { ear: 0.16, perclos: 0 };
    expect(computeDrowsinessScore(s, defaultDriver).components.visionScore).toBeGreaterThan(0.2);
    const live = computeDrowsinessScore({ ...s, earBaseline: 0.17 }, defaultDriver);
    expect(live.components.visionScore).toBe(0);
    expect(live.classification).toBe('alert');
  });

  test('closed narrow eyes still count, and the cut-off stays within safe bounds', () => {
    const closed = computeDrowsinessScore(
      { ear: 0.06, perclos: 0.6, earBaseline: 0.17 },
      defaultDriver,
    );
    expect(closed.components.visionScore).toBeGreaterThan(0.4);
    expect(resolveThresholds(defaultDriver, { earBaseline: 0.1 }).earThreshold).toBe(0.12);
    expect(resolveThresholds(defaultDriver, { earBaseline: 0.9 }).earThreshold).toBe(0.35);
    expect(resolveThresholds(defaultDriver, {}).earThreshold).toBe(DEFAULT_THRESHOLDS.earThreshold);
  });
});

describe('fusionEngine — fuzzy fatigue from the camera', () => {
  test('a combination the weighted sum misses raises the verdict', () => {
    const calm = { ear: 0.3, perclos: 0.1, yawnCount: 1 };
    expect(computeDrowsinessScore(calm, defaultDriver).classification).toBe('alert');
    const r = computeDrowsinessScore({ ...calm, fuzzyScore: 0.82 }, defaultDriver);
    expect(r.classification).toBe('drowsy');
    expect(r.components.fuzzyScore).toBe(0.82);
  });

  test('a low fuzzy score never lowers strong evidence', () => {
    const r = computeDrowsinessScore(
      { ear: 0.05, perclos: 0.9, heartRate: 50, fuzzyScore: 0 },
      defaultDriver,
    );
    expect(r.classification).toBe('drowsy');
  });
});

describe('fusionEngine — recovery when the driver is awake again', () => {
  test('old nods / yawns in the 5-minute count no longer pin the status once the camera says awake', () => {
    const old = { ear: 0.3, perclos: 0.05, nodCount: 2, yawnCount: 3 };
    expect(computeDrowsinessScore(old, defaultDriver).classification).toBe('drowsy'); // older device
    const r = computeDrowsinessScore({ ...old, fuzzyScore: 0.15 }, defaultDriver);
    expect(r.classification).toBe('alert');
    expect(r.components.nodEscalated).toBe(true); // still typed for the parent's nodding alert
  });
});
