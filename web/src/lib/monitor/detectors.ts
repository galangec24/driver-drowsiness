/**
 * TESTING PHASE: the in-car driver monitor's detectors, ported from driver_monitor/detectors/*.py
 * so the phone-browser monitor (pages/MonitorPage.tsx) behaves like the local one. Same constants,
 * same field-tested thresholds; see the Python files for the reasoning behind each number.
 * Times are seconds; landmarks are pixel (x, y).
 */

export type Pt = { x: number; y: number };

// ------------------------------------------------------------------ EAR (detectors/ear.py)

export const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
export const LEFT_EYE = [362, 385, 387, 263, 373, 380];

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function eyeAspectRatio(eye: Pt[]): number {
  const horizontal = dist(eye[0]!, eye[3]!);
  if (horizontal <= 1e-9) return 0;
  return (dist(eye[1]!, eye[5]!) + dist(eye[2]!, eye[4]!)) / (2 * horizontal);
}

/** EAR of the more open eye: one open eye means awake (wink, dust, head turned). */
export function openEyeEar(lm: Pt[]): number {
  return Math.max(eyeAspectRatio(RIGHT_EYE.map((i) => lm[i]!)), eyeAspectRatio(LEFT_EYE.map((i) => lm[i]!)));
}

/** Both eyes inside the picture (2 % margin): EAR at the edge reads as "closed". */
export function eyesInFrame(lm: Pt[], w: number, h: number, margin = 0.02): boolean {
  const mx = w * margin;
  const my = h * margin;
  return [...RIGHT_EYE, ...LEFT_EYE].every((i) => {
    const p = lm[i]!;
    return p.x >= mx && p.x <= w - mx && p.y >= my && p.y <= h - my;
  });
}

// ------------------------------------------------------------------ MAR (detectors/mouth.py)

const VERTICAL_PAIRS: [number, number][] = [
  [82, 87],
  [13, 14],
  [312, 317],
];
const CORNERS: [number, number] = [78, 308];

export function mouthAspectRatio(lm: Pt[]): number {
  const width = dist(lm[CORNERS[0]]!, lm[CORNERS[1]]!);
  if (width <= 1e-6) return 0;
  return VERTICAL_PAIRS.reduce((s, [u, l]) => s + dist(lm[u]!, lm[l]!), 0) / (VERTICAL_PAIRS.length * width);
}

function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const k = ((s.length - 1) * p) / 100;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (k - lo);
}

const median = (v: number[]) => percentile(v, 50);

// ------------------------------------------------------------------ PERCLOS (detectors/perclos.py)

export class PerclosTracker {
  windowS = 30;
  closureRatio = 0.5;
  baselineWindowS = 120;
  baselinePercentile = 90;
  minBaselineSamples = 15;
  reopenMargin = 0.05;
  openGraceS = 0.3;
  minCoverageS = 3;
  dropBeforeLossS = 0.6;
  clearlyOpenRatio = 0.75;
  blinkMaxS = 0.4;
  frameS = 0.1;

  private lastClosedT: number | null = null;
  private openSince: number | null = null;
  private isClosedNow = false;
  private lost = false;
  private closed: [number, boolean][] = [];
  private ears: [number, number][] = [];
  private closedSince: number | null = null;
  rawClosed = false;

  get baseline(): number | null {
    if (this.ears.length < this.minBaselineSamples) return null;
    return percentile(
      this.ears.map((e) => e[1]),
      this.baselinePercentile,
    );
  }

  get isClosed(): boolean {
    return this.isClosedNow;
  }

  update(ear: number, t: number, reliable = true): number {
    this.lost = false;
    if (!reliable) {
      this.closedSince = null;
      this.openSince = null;
      this.isClosedNow = false;
      this.rawClosed = false;
      return this.value;
    }
    this.ears.push([t, ear]);
    while (this.ears.length && t - this.ears[0]![0] > this.baselineWindowS) this.ears.shift();
    const base = this.baseline;
    this.rawClosed = base !== null && ear < base * this.closureRatio;
    let closed: boolean;
    if (base === null) closed = false;
    else if (this.isClosedNow) closed = ear < base * Math.min(0.95, this.closureRatio + this.reopenMargin);
    else closed = ear < base * this.closureRatio;
    this.isClosedNow = closed;
    if (closed) {
      this.openSince = null;
      this.closedSince ??= t;
      this.lastClosedT = t;
    } else if (this.closedSince !== null) {
      this.openSince ??= t;
      const clearlyOpen = base !== null && ear >= base * this.clearlyOpenRatio;
      if (clearlyOpen || t - this.openSince >= this.openGraceS) this.endClosure(t);
    }
    this.closed.push([t, closed]);
    while (this.closed.length && t - this.closed[0]![0] > this.windowS) this.closed.shift();
    return this.value;
  }

  private endClosure(t: number) {
    const start = this.closedSince;
    const last = this.lastClosedT;
    this.closedSince = null;
    this.openSince = null;
    if (start === null || last === null) return;
    const duration = last - start + Math.min(t - last, this.frameS);
    if (duration < this.blinkMaxS) {
      this.closed = this.closed.map(([ts, c]) => [ts, ts >= start ? false : c]);
    }
  }

  closedFor(t: number): number {
    return this.closedSince === null ? 0 : t - this.closedSince;
  }

  markNoFace(t: number) {
    if (!this.lost) {
      this.lost = true;
      const last = this.closed.length ? this.closed[this.closed.length - 1]![0] : t;
      while (this.closed.length && last - this.closed[this.closed.length - 1]![0] < this.dropBeforeLossS) {
        this.closed.pop();
      }
    }
    this.closedSince = null;
    this.openSince = null;
    this.isClosedNow = false;
    while (this.closed.length && t - this.closed[0]![0] > this.windowS) this.closed.shift();
  }

  recent(t: number, spanS = 10): number {
    const pts = this.closed.filter(([ts]) => t - ts <= spanS).map(([, c]) => c);
    if (pts.length < 5) return 0;
    return pts.filter(Boolean).length / pts.length;
  }

  effective(t: number, spanS = 6): number {
    return Math.min(this.value, this.recent(t, spanS));
  }

  get value(): number {
    if (!this.closed.length || this.closed[this.closed.length - 1]![0] - this.closed[0]![0] < this.minCoverageS) {
      return 0;
    }
    return this.closed.filter(([, c]) => c).length / this.closed.length;
  }
}

// ------------------------------------------------------------------ blinks (detectors/blink.py)

export class BlinkDetector {
  longS = 0.5;
  microsleepS = 2;
  windowS = 180;
  minObservedS = 120;
  longWindowS = 120;
  maxGapS = 0.5;
  frameS = 0.1;
  private lastClosedT: number | null = null;
  private closedAt: number | null = null;
  private lastT: number | null = null;
  private observed: [number, number][] = [];
  private blinks: number[] = [];
  private long: number[] = [];

  update(closed: boolean | null, t: number) {
    if (closed === null) {
      this.closedAt = null;
      this.lastT = null;
      this.expire(t);
      return;
    }
    if (this.lastT !== null) this.observed.push([t, Math.min(t - this.lastT, this.maxGapS)]);
    this.lastT = t;
    if (closed) {
      this.closedAt ??= t;
      this.lastClosedT = t;
    } else if (this.closedAt !== null) {
      const last = this.lastClosedT ?? this.closedAt;
      const dur = last - this.closedAt + Math.min(t - last, this.frameS);
      this.closedAt = null;
      if (dur < this.longS) this.blinks.push(t);
      else if (dur < this.microsleepS) this.long.push(t);
    }
    this.expire(t);
  }

  observedS(): number {
    return this.observed.reduce((s, [, d]) => s + d, 0);
  }

  rate(t: number): number | null {
    this.expire(t);
    const watched = this.observedS();
    if (watched < this.minObservedS) return null;
    return ((this.blinks.length + this.long.length) * 60) / watched;
  }

  longBlinks(t: number): number {
    this.expire(t);
    return this.long.filter((e) => t - e <= this.longWindowS).length;
  }

  sustainedLong(t: number, holdS = 15, fadeS = 30): number {
    const n = this.longBlinks(t);
    const recent = this.long.filter((e) => t - e <= this.longWindowS);
    if (!n || !recent.length) return 0;
    const since = t - recent[recent.length - 1]!;
    const weight = since <= holdS ? 1 : Math.max(0, 1 - (since - holdS) / fadeS);
    return n * weight;
  }

  private expire(t: number) {
    while (this.blinks.length && t - this.blinks[0]! > this.windowS) this.blinks.shift();
    while (this.long.length && t - this.long[0]! > this.windowS) this.long.shift();
    while (this.observed.length && t - this.observed[0]![0] > this.windowS) this.observed.shift();
  }
}

// ------------------------------------------------------------------ yawns (detectors/mouth.py)

/** Events in a window, with the recency weightings the fuzzy scorer uses. */
class Events {
  protected events: number[] = [];
  constructor(protected windowS: number) {}
  protected expire(t: number) {
    while (this.events.length && t - this.events[0]! > this.windowS) this.events.shift();
  }
  count(t: number): number {
    this.expire(t);
    return this.events.length;
  }
  recent(t: number, halfLifeS = 30): number {
    this.expire(t);
    return this.events.reduce((s, e) => s + 0.5 ** ((t - e) / halfLifeS), 0);
  }
  sustained(t: number, holdS = 120, fadeS = 180): number {
    this.expire(t);
    if (!this.events.length) return 0;
    const since = t - this.events[this.events.length - 1]!;
    const weight = since <= holdS ? 1 : Math.max(0, 1 - (since - holdS) / fadeS);
    return this.events.length * weight;
  }
}

export class YawnDetector extends Events {
  openThreshold = 0.5;
  closeThreshold = 0.35;
  minDurationS = 1.5;
  private openedAt: number | null = null;
  yawning = false;

  constructor() {
    super(600);
  }

  update(mar: number | null, t: number): boolean {
    this.expire(t);
    if (mar === null || mar < this.closeThreshold) {
      this.openedAt = null;
      this.yawning = false;
      return false;
    }
    if (mar >= this.openThreshold && this.openedAt === null) this.openedAt = t;
    if (this.openedAt !== null && !this.yawning && t - this.openedAt >= this.minDurationS) {
      this.yawning = true;
      this.events.push(t);
      return true;
    }
    return false;
  }
}

// ------------------------------------------------------------------ head nods (detectors/head_nod.py)

export interface Pose {
  pitch: number; // head down = negative
  yaw: number;
  roll: number;
}

export class NodDetector extends Events {
  dropDeg = 15;
  minDropSpeed = 25;
  minRecoverSpeed = 40;
  maxDownS = 4;
  neutralWindowS = 30;
  private pitch: [number, number][] = [];
  private recentP: [number, number][] = [];
  private state: 'neutral' | 'down' | 'looking' = 'neutral';
  private downAt = 0;
  private eyesClosedWhileDown = false;

  constructor() {
    super(300);
  }

  get neutral(): number | null {
    if (this.pitch.length < 20) return null;
    return median(this.pitch.map((p) => p[1]));
  }

  update(pitch: number | null, eyesClosed: boolean, t: number): boolean {
    this.expire(t);
    if (pitch === null) {
      this.state = 'neutral';
      this.recentP = [];
      return false;
    }
    const neutral = this.neutral;
    this.recentP.push([t, pitch]);
    while (this.recentP.length && t - this.recentP[0]![0] > 0.6) this.recentP.shift();
    if (neutral === null) {
      this.remember(t, pitch);
      return false;
    }
    const drop = neutral - pitch;
    const fallSpeed = -this.speed(0.5);
    if (this.state === 'neutral') {
      this.remember(t, pitch);
      if (drop >= this.dropDeg) {
        if (fallSpeed >= this.minDropSpeed) {
          this.state = 'down';
          this.downAt = t;
          this.eyesClosedWhileDown = eyesClosed;
        } else {
          this.state = 'looking';
        }
      }
      return false;
    }
    if (this.state === 'looking') {
      if (drop < this.dropDeg / 2) this.state = 'neutral';
      return false;
    }
    if (drop < this.dropDeg / 2) {
      const snapped = this.speed(0.3) >= this.minRecoverSpeed && t - this.downAt <= this.maxDownS;
      this.state = 'neutral';
      if (this.eyesClosedWhileDown || snapped) return this.countNod(t);
      return false;
    }
    if (t - this.downAt > this.maxDownS) {
      this.state = 'looking';
      if (this.eyesClosedWhileDown) return this.countNod(t);
    }
    return false;
  }

  private remember(t: number, pitch: number) {
    this.pitch.push([t, pitch]);
    while (this.pitch.length && t - this.pitch[0]![0] > this.neutralWindowS) this.pitch.shift();
  }

  private speed(spanS: number): number {
    if (this.recentP.length < 2) return 0;
    const [t1, p1] = this.recentP[this.recentP.length - 1]!;
    const [t0, p0] = this.recentP.find(([t]) => t1 - t <= spanS + 1e-6) ?? this.recentP[0]!;
    return t1 > t0 ? (p1 - p0) / (t1 - t0) : 0;
  }

  private countNod(t: number): boolean {
    this.events.push(t);
    return true;
  }
}

// ------------------------------------------------------------------ distraction (detectors/distraction.py)

export interface DistractionState {
  awayForS: number;
  restless: boolean;
  count: number;
}

export class DistractionDetector {
  yawLimitDeg = 30;
  pitchDownDeg = 22;
  awayS = 2;
  awayLongS = 5;
  windowS = 10;
  restlessSpeed = 30;
  neutralWindowS = 60;
  lostFaceGraceS = 3;
  settleS = 1.5;
  eyeYawLimitDeg = 25;
  leftMove = 0.2;
  leftWindowS = 1.5;
  /** Set from GPS: true while the car is stopped (< 5 km/h). */
  parked = false;
  state: DistractionState = { awayForS: 0, restless: false, count: 0 };

  private returnedAt: number | null = null;
  private poses: [number, number, number, number][] = [];
  private awaySince: number | null = null;
  private lastFaceT: number | null = null;
  private restlessOn = false;
  private episodes: number[] = [];
  private countedAway = false;
  private positions: [number, number, number, boolean][] = [];
  private leftSeat = false;

  neutral(): [number, number] | null {
    if (this.poses.length < 20) return null;
    return [median(this.poses.map((p) => p[1])), median(this.poses.map((p) => p[2]))];
  }

  private speed(t: number): number {
    const pts = this.poses.filter((p) => t - p[0] <= this.windowS);
    if (pts.length < 10 || pts[pts.length - 1]![0] - pts[0]![0] < this.windowS * 0.7) return 0;
    let moved = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      moved += Math.abs(b![1] - a![1]) + Math.abs(b![2] - a![2]) + Math.abs(b![3] - a![3]) * 0.5;
    }
    return moved / (pts[pts.length - 1]![0] - pts[0]![0]);
  }

  count(t: number): number {
    while (this.episodes.length && t - this.episodes[0]! > 300) this.episodes.shift();
    return this.episodes.length;
  }

  eyesReliable(pose: Pose | null, t: number): boolean {
    if (!pose) return false;
    if (this.returnedAt !== null && t - this.returnedAt < this.settleS) return false;
    const n = this.neutral();
    if (!n) return true;
    return Math.abs(pose.yaw - n[1]) <= this.eyeYawLimitDeg && pose.pitch - n[0] >= -this.pitchDownDeg;
  }

  private leftPicture(): boolean {
    if (!this.positions.length) return false;
    if (this.positions[this.positions.length - 1]![3]) return true;
    const xs = this.positions.map((p) => p[1]);
    const ys = this.positions.map((p) => p[2]);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) >= this.leftMove;
  }

  update(pose: Pose | null, t: number, facePos: [number, number, boolean] | null = null): DistractionState {
    const n = this.neutral();
    let away = false;
    if (facePos) {
      this.positions.push([t, ...facePos]);
      while (this.positions.length && t - this.positions[0]![0] > this.leftWindowS) this.positions.shift();
    }
    if (pose) {
      this.leftSeat = false;
      if (this.lastFaceT !== null && t - this.lastFaceT >= 1) this.returnedAt = t;
      this.lastFaceT = t;
      this.poses.push([t, pose.pitch, pose.yaw, pose.roll]);
      while (this.poses.length && t - this.poses[0]![0] > this.neutralWindowS) this.poses.shift();
      if (n) away = Math.abs(pose.yaw - n[1]) > this.yawLimitDeg || pose.pitch - n[0] < -this.pitchDownDeg;
    } else if (this.lastFaceT !== null && t - this.lastFaceT <= this.lostFaceGraceS + this.awayLongS) {
      const lastPos = this.positions[this.positions.length - 1]!;
      if (!this.leftSeat && lastPos && t - lastPos[0] < 0.5) this.leftSeat = this.leftPicture();
      away = t - this.lastFaceT > 0.5 && !this.leftSeat;
    }
    if (!pose && t - (this.lastFaceT ?? t) > this.leftWindowS) this.positions = [];
    if (this.parked) away = false;
    let awayFor = 0;
    if (away) {
      if (this.awaySince === null) {
        this.awaySince = t;
        this.countedAway = false;
      }
      awayFor = t - this.awaySince;
      if (awayFor >= this.awayS && !this.countedAway) {
        this.episodes.push(t);
        this.countedAway = true;
      }
    } else {
      this.awaySince = null;
    }
    const restless = this.speed(t) >= this.restlessSpeed && !this.parked;
    if (restless && !this.restlessOn) this.episodes.push(t);
    this.restlessOn = restless;
    this.state = { awayForS: Math.round(awayFor * 100) / 100, restless, count: this.count(t) };
    return this.state;
  }
}

/**
 * Head pose from MediaPipe's facial transformation matrix (4×4, column-major). Same convention as
 * the Python monitor: degrees, head down = negative pitch. Everything downstream is relative to
 * the driver's own neutral pose, so only the sign of pitch matters.
 */
export function poseFromMatrix(m: ArrayLike<number>): Pose {
  const r = (row: number, col: number) => m[col * 4 + row] ?? 0;
  const deg = (a: number) => (a * 180) / Math.PI;
  const sy = Math.hypot(r(0, 0), r(1, 0));
  const tiltDown = Math.atan2(r(2, 1), r(2, 2)); // + when the chin goes down (y up in model space)
  const yaw = Math.atan2(-r(2, 0), sy);
  const roll = Math.atan2(r(1, 0), r(0, 0));
  return { pitch: -deg(tiltDown), yaw: deg(yaw), roll: deg(roll) };
}
