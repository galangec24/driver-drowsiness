/**
 * TESTING PHASE: one analysed frame → signals, and once a second → the ingest payload.
 * The browser twin of driver_monitor/main.py (Monitor.process_frame + make_payload): same
 * detectors, same order, same payload fields. No camera / network here, so it can be tested.
 */
import {
  BlinkDetector,
  DistractionDetector,
  NodDetector,
  PerclosTracker,
  YawnDetector,
  eyesInFrame,
  mouthAspectRatio,
  openEyeEar,
  type Pose,
  type Pt,
} from './detectors';
import { FatigueFuzzy, type FuzzyResult } from './fuzzy';

export interface FrameInput {
  /** Driver's face landmarks in pixels (the largest face), or null when no face. */
  landmarks: Pt[] | null;
  pose: Pose | null;
  width: number;
  height: number;
}

export interface FrameResult {
  face: boolean;
  ear: number | null;
  mar: number | null;
  perclos: number;
  closedForS: number;
  eyesReliable: boolean;
  nodded: boolean;
  yawning: boolean;
  awayForS: number;
  restless: boolean;
  fatigue: FuzzyResult;
  /** Face box in pixels (for the alert photo crop). */
  box: { x: number; y: number; w: number; h: number } | null;
}

export interface GeoFix {
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
}

export interface Thresholds {
  drowsyDurationMs?: number;
  perclosThreshold?: number;
  yawnThreshold?: number;
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export class MonitorEngine {
  perclos = new PerclosTracker();
  blink = new BlinkDetector();
  yawn = new YawnDetector();
  nod = new NodDetector();
  distraction = new DistractionDetector();
  fuzzy = new FatigueFuzzy();
  fatigue: FuzzyResult = { score: 0, level: 0, category: 'Alert', reason: '' };
  private ears: number[] = [];
  private faceFrames = 0;
  private frames = 0;
  private marMax: number | null = null;
  private maxClosedS = 0;

  constructor(public driverId: string) {}

  applyThresholds(t: Thresholds, yawnMar?: number | null) {
    this.fuzzy.setLimits(t.perclosThreshold ?? 0.4, (t.drowsyDurationMs ?? 2000) / 1000, t.yawnThreshold ?? 3);
    // Admin-calibrated yawn threshold (same rule as the in-car device's MODEL_SYNC).
    if (typeof yawnMar === 'number' && yawnMar > 0.1 && yawnMar < 1.5) {
      this.yawn.openThreshold = yawnMar;
      this.yawn.closeThreshold = yawnMar * 0.7;
    }
  }

  process(input: FrameInput, t: number): FrameResult {
    const { landmarks: lm, pose, width: w, height: h } = input;
    let ear: number | null = null;
    let mar: number | null = null;
    let eyesReliable = false;
    let box: FrameResult['box'] = null;
    this.frames += 1;
    if (lm) {
      ear = openEyeEar(lm);
      mar = mouthAspectRatio(lm);
      const xs = lm.map((p) => p.x);
      const ys = lm.map((p) => p.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      box = { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
      const edge = box.x <= 2 || box.y <= 2 || box.x + box.w >= w - 2 || box.y + box.h >= h - 2;
      this.distraction.update(pose, t, [(box.x + box.w / 2) / w, (box.y + box.h / 2) / h, edge]);
      eyesReliable = eyesInFrame(lm, w, h) && this.distraction.eyesReliable(pose, t);
      this.perclos.update(ear, t, eyesReliable);
      const calibrated = this.perclos.baseline !== null;
      this.blink.update(eyesReliable && calibrated ? this.perclos.rawClosed : null, t);
      this.faceFrames += 1;
      if (eyesReliable) this.ears.push(ear);
      if (mar !== null) this.marMax = this.marMax === null ? mar : Math.max(this.marMax, mar);
    } else {
      this.perclos.markNoFace(t);
      this.distraction.update(null, t);
      this.blink.update(null, t);
    }
    const nodded = this.nod.update(pose ? pose.pitch : null, this.perclos.closedFor(t) >= 0.4, t);
    this.yawn.update(mar, t);
    const face = lm !== null;
    const closedForS = this.perclos.closedFor(t);
    this.maxClosedS = Math.max(this.maxClosedS, closedForS);
    this.fatigue = this.fuzzy.evaluate({
      perclos: face ? this.perclos.effective(t) : null,
      closure_s: face ? closedForS : null,
      blink_rate: this.blink.rate(t),
      long_blinks: this.blink.observedS() >= 60 ? this.blink.sustainedLong(t) : null,
      yawns: this.yawn.sustained(t),
      nods: this.nod.recent(t),
    });
    const d = this.distraction.state;
    return {
      face,
      ear,
      mar,
      perclos: this.perclos.value,
      closedForS,
      eyesReliable,
      nodded,
      yawning: this.yawn.yawning,
      awayForS: d.awayForS,
      restless: d.restless,
      fatigue: this.fatigue,
      box,
    };
  }

  /** The once-a-second reading: the same fields the in-car device sends to /api/ingest. */
  payload(t: number, location: GeoFix | null): Record<string, unknown> {
    const ear = this.ears.length ? this.ears.reduce((s, e) => s + e, 0) / this.ears.length : null;
    const faceConf = this.frames ? this.faceFrames / this.frames : 0;
    const signals: Record<string, unknown> = {};
    if (ear !== null) {
      signals.ear = round(ear);
      signals.perclos = round(this.perclos.value);
    }
    signals.heartRate = 0;
    signals.faceConfidence = round(faceConf);
    signals.matchedDriver = this.driverId;
    signals.yawnCount = this.yawn.count(t);
    signals.nodCount = this.nod.count(t);
    signals.distractionCount = this.distraction.count(t);
    signals.longBlinkCount = this.blink.longBlinks(t);
    signals.fuzzyScore = this.fatigue.score;
    signals.closedForS = round(this.maxClosedS, 1);
    if (this.fatigue.level > 0 && this.fatigue.reason) {
      signals.fatigueReason = `${this.fatigue.category}: ${this.fatigue.reason}`.slice(0, 120);
    }
    const rate = this.blink.rate(t);
    if (rate !== null) signals.blinkRate = round(rate, 1);
    const base = this.perclos.baseline;
    if (base !== null) signals.earBaseline = round(base);
    if (this.marMax !== null) signals.mar = round(this.marMax);

    this.ears = [];
    this.faceFrames = 0;
    this.frames = 0;
    this.marMax = null;
    this.maxClosedS = 0;
    // Parked (GPS speed under 5 km/h): looking around or getting out is not distraction.
    this.distraction.parked = typeof location?.speed === 'number' && location.speed < 5;
    return {
      driverId: this.driverId,
      source: 'web_monitor',
      signals,
      timestamp: new Date().toISOString(),
      ...(location && { location }),
    };
  }
}
