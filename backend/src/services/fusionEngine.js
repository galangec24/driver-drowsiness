/**
 * Adaptive multimodal fusion. All thresholds come from driver.personalThresholds —
 * never hardcode EAR/PERCLOS/HR cut-offs here.
 *
 * Inputs (all optional; a missing signal contributes no evidence):
 *   vision   ear, perclos                      (driver_monitor camera)
 *            earBaseline                       (the camera's live open-eye EAR for this driver:
 *                                               the EAR cut-off follows it, so narrow eyes are
 *                                               not read as half closed)
 *   physio   heartRate                         (absolute rule, any source)
 *            hrBaseline, hrv, hrvBaseline      (BLE watch/radar: personal HR drop + HRV rise)
 *            breathingRate, breathingBaseline  (dashboard radar: personal breathing slow-down)
 *   yawning  yawnCount                         (yawns in the last 5 minutes, camera)
 *   nodding  nodCount                          (head nods in the last 5 minutes, camera)
 *   fuzzy    fuzzyScore                        (camera's fuzzy-logic fatigue 0..1 over blink rate,
 *                                               slow blinks, yawns, nods, PERCLOS, closure time —
 *                                               driver_monitor/fusion/fuzzy.py); the fused score is
 *                                               never lower than it
 * Without the wearable/yawn fields the score is identical to the original formula.
 * Full description: docs/WEARABLE.md § Fusion.
 */

const DEFAULT_THRESHOLDS = Object.freeze({
  earThreshold: 0.21,
  perclosThreshold: 0.4,
  drowsyDurationMs: 2000,
  fusionWeightVision: 0.6,
  fusionWeightPhysio: 0.4,
  // Yawns in 5 minutes that count as full yawning evidence (and alone raise a warning).
  yawnThreshold: 3,
  // Distraction episodes (eyes off the road / restless movement) in 5 minutes that alert the parent.
  distractionThreshold: 2,
  // Extra weight of yawning in the fused score (added on top of vision + physio).
  fusionWeightYawn: 0.2,
  // Fractional heart-rate drop below the driver's own awake baseline that counts as full evidence.
  hrDropThreshold: 0.15,
  // Fractional breathing-rate drop below the driver's own baseline that counts as full evidence.
  breathDropThreshold: 0.2,
  // Head nods in 5 minutes that count as full evidence; reaching it means falling asleep (drowsy).
  nodThreshold: 2,
  // Extra weight of head nods in the fused score.
  fusionWeightNod: 0.3,
});

// Classification bands (backend/CLAUDE.md § 5).
const DROWSY_BAND = 0.7;
const WARNING_BAND = 0.4;
// HRV (RMSSD) this much above its baseline counts as full evidence (+50 %).
const HRV_RISE_FULL = 0.5;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// EAR cut-off from the camera's live open-eye baseline (same rule as the hourly tuner).
const LIVE_EAR = Object.freeze({ closureRatio: 0.75, min: 0.12, max: 0.35 });

/**
 * @param {object} driver
 * @param {{earBaseline?:number}} [signals] when the reading carries the camera's live open-eye
 *   EAR, the cut-off follows it (more current than the hourly tuned value: same camera, light, eyes).
 */
function resolveThresholds(driver, signals) {
  const t = (driver && driver.personalThresholds) || {};
  const out = {};
  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    const v = num(t[key]);
    out[key] = v !== null && v > 0 ? v : DEFAULT_THRESHOLDS[key];
  }
  const base = num(signals && signals.earBaseline);
  if (base !== null && base > 0) {
    out.earThreshold = clamp(base * LIVE_EAR.closureRatio, LIVE_EAR.min, LIVE_EAR.max);
  }
  return out;
}

function classify(score) {
  if (score > DROWSY_BAND) return 'drowsy';
  if (score > WARNING_BAND) return 'warning';
  return 'alert';
}

function positivePair(a, b) {
  const x = num(a);
  const y = num(b);
  return x !== null && x > 0 && y !== null && y > 0 ? [x, y] : null;
}

/**
 * Personal physiology, each part relative to the driver's own baseline from the start of the trip:
 * HR drop (weight 0.7), HRV rise (0.3), breathing slow-down (0.4) — weighted mean of the parts
 * that are available. HR alone → hrScore; HR + HRV → 0.7·hr + 0.3·hrv (unchanged from before).
 */
function relativePhysio(heartRate, s, t) {
  const parts = [];
  const hr = positivePair(heartRate, s.hrBaseline);
  if (hr) parts.push([0.7, clamp((hr[1] - hr[0]) / hr[1] / t.hrDropThreshold, 0, 1)]);
  const hrv = hr && positivePair(s.hrv, s.hrvBaseline);
  if (hrv) parts.push([0.3, clamp((hrv[0] / hrv[1] - 1) / HRV_RISE_FULL, 0, 1)]);
  const br = positivePair(s.breathingRate, s.breathingBaseline);
  if (br) parts.push([0.4, clamp((br[1] - br[0]) / br[1] / t.breathDropThreshold, 0, 1)]);
  if (!parts.length) return 0;
  const weight = parts.reduce((sum, [w]) => sum + w, 0);
  return parts.reduce((sum, [w, v]) => sum + w * v, 0) / weight;
}

/**
 * @param {{ear?:number, perclos?:number, heartRate?:number, hrBaseline?:number, hrv?:number,
 *          hrvBaseline?:number, yawnCount?:number}} signals
 * @param {{personalThresholds?:object}} driver
 * @returns {{fusionScore:number, classification:'alert'|'warning'|'drowsy', components:object}}
 */
function computeDrowsinessScore(signals, driver) {
  const s = signals || {};
  const t = resolveThresholds(driver, s);

  const ear = num(s.ear);
  const perclos = num(s.perclos);
  const heartRate = num(s.heartRate);
  const yawnCount = num(s.yawnCount);
  const nodCount = num(s.nodCount);

  // Missing signals contribute 0 (no evidence of drowsiness) instead of throwing.
  const visionScore = ear === null ? 0 : clamp((t.earThreshold - ear) / t.earThreshold, 0, 1);
  const perclosScore = perclos === null ? 0 : clamp(perclos / t.perclosThreshold, 0, 1);
  // heartRate 0 means "no sensor" (driver_monitor sends 0 when no wearable is connected).
  const absolutePhysio =
    heartRate !== null && heartRate > 0 && heartRate < 60 ? clamp((60 - heartRate) / 15, 0, 1) : 0;
  const physioScore = Math.max(absolutePhysio, relativePhysio(heartRate, s, t));
  const yawnScore = yawnCount === null ? 0 : clamp(yawnCount / t.yawnThreshold, 0, 1);
  const nodScore = nodCount === null ? 0 : clamp(nodCount / t.nodThreshold, 0, 1);

  const fuzzy = num(s.fuzzyScore);
  const fuzzyScore = fuzzy === null ? 0 : clamp(fuzzy, 0, 1);
  // The camera's fuzzy score already weighs nods / yawns by how recent they are, so a driver who
  // is awake again recovers within a minute. Without it (older devices), the 5-minute counts
  // decide on their own: in the weighted sum and as escalations below.
  const countsDecide = fuzzy === null;
  const countWeight = countsDecide ? 1 : 0;
  // Combinations of mild signs (frequent blinking + yawning, slow blinks + eyes closing more) are
  // judged by the camera's fuzzy rules; the weighted sum below can't express "A and B together".
  const fused = Math.max(
    fuzzyScore,
    clamp(
      t.fusionWeightVision * (0.6 * visionScore + 0.4 * perclosScore) +
        t.fusionWeightPhysio * physioScore +
        countWeight * (t.fusionWeightYawn * yawnScore + t.fusionWeightNod * nodScore),
      0,
      1,
    ),
  );

  let classification = classify(fused);
  // Repeated head nods = the driver is falling asleep, whatever the other signals say.
  const nodEscalated =
    classification !== 'drowsy' && nodCount !== null && nodCount >= t.nodThreshold;
  if (nodEscalated && countsDecide) classification = 'drowsy';
  // Repeated yawning is an early fatigue sign on its own, even with the eyes still open.
  const yawnEscalated =
    classification === 'alert' && yawnCount !== null && yawnCount >= t.yawnThreshold;
  if (yawnEscalated && countsDecide) classification = 'warning';

  return {
    fusionScore: fused,
    classification,
    components: {
      visionScore,
      perclosScore,
      physioScore,
      yawnScore,
      nodScore,
      fuzzyScore,
      yawnEscalated,
      nodEscalated,
    },
  };
}

module.exports = {
  computeDrowsinessScore,
  classify,
  resolveThresholds,
  DEFAULT_THRESHOLDS,
  DROWSY_BAND,
  WARNING_BAND,
};
