/**
 * TESTING PHASE: fuzzy fatigue scorer and in-car alarm levels, ported from
 * driver_monitor/fusion/fuzzy.py and fusion/watch_alerts.py (same rules, sets and timings).
 */

type Trap = [number, number, number, number];

export function trap(x: number, [a, b, c, d]: Trap): number {
  if (x < a || x > d) return 0;
  if (b <= x && x <= c) return 1;
  if (x < b) return b > a ? (x - a) / (b - a) : 1;
  return d > c ? (d - x) / (d - c) : 1;
}

const OUTPUT: Record<'low' | 'medium' | 'high', Trap> = {
  low: [0, 0, 0.2, 0.4],
  medium: [0.3, 0.5, 0.5, 0.7],
  high: [0.6, 0.8, 1, 1],
};
const XS = Array.from({ length: 101 }, (_, i) => i / 100);

type Out = keyof typeof OUTPUT;
interface Cond {
  v: string;
  term: string;
  not?: boolean;
}
interface Rule {
  conds: Cond[];
  out: Out;
  label: string;
}

const c = (spec: string): Cond => {
  const [v, op, term] = spec.split(' ');
  return { v: v!, term: term!, not: op === 'not' };
};
const rule = (out: Out, label: string, ...conds: string[]): Rule => ({ out, label, conds: conds.map(c) });

const RULES: Rule[] = [
  rule('high', 'eyes closed much of the time', 'perclos is high'),
  rule('high', 'eyes closed too long (microsleep)', 'closure_s is long'),
  rule('high', 'repeated head nods', 'nods is many'),
  rule('high', 'slow blinks and repeated yawning', 'long_blinks is many', 'yawns is some'),
  rule('high', 'slow blinks, eyes closing more', 'long_blinks is many', 'perclos is medium'),
  rule('high', 'repeated yawning, eyes closing more', 'yawns is many', 'perclos is medium'),
  rule('high', 'unusual blinking and repeated yawning', 'blink_rate is high', 'yawns is many'),
  rule('medium', 'many slow blinks (6+ in 2 min)', 'long_blinks is many'),
  rule('medium', 'repeated yawning (3+ in 10 min)', 'yawns is many'),
  rule('medium', 'eyes closing more often', 'perclos is medium'),
  rule('medium', 'head nod', 'nods is some'),
  rule('medium', 'unusual, slow blinking', 'blink_rate is high', 'long_blinks is some'),
  rule('medium', 'unusual blinking and yawning', 'blink_rate is high', 'yawns is some'),
  rule('medium', 'slow blinks and yawning', 'long_blinks is some', 'yawns is some'),
  rule(
    'low',
    'awake',
    'perclos is low',
    'closure_s is short',
    'nods is none',
    'yawns not many',
    'long_blinks not many',
  ),
];

function inputSets(L: number, D: number, Y: number): Record<string, Record<string, Trap>> {
  const big = 1e9;
  return {
    perclos: {
      low: [0, 0, 0.5 * L, 0.75 * L],
      medium: [0.5 * L, 0.75 * L, 0.75 * L, L],
      high: [0.75 * L, L, big, big],
    },
    closure_s: { short: [0, 0, 0.3 * D, 0.6 * D], long: [0.4 * D, D, big, big] },
    blink_rate: { normal: [0, 0, 20, 28], high: [20, 28, big, big] },
    long_blinks: { few: [0, 0, 1, 3], some: [2, 3, 4, 6], many: [4, 6, big, big] },
    yawns: { none: [0, 0, 1, 2], some: [1, 2, Y - 1, Y], many: [Y - 1, Y, big, big] },
    nods: { none: [0, 0, 0, 1], some: [0, 1, 1, 2], many: [1, 2, big, big] },
  };
}

export const DROWSY_BAND = 0.7;
export const WARNING_BAND = 0.4;
const CATEGORY = ['Alert', 'Fatigue signs', 'Drowsy'];

export interface FuzzyResult {
  score: number;
  level: 0 | 1 | 2;
  category: string;
  reason: string;
}

export type FuzzyInputs = Partial<
  Record<'perclos' | 'closure_s' | 'blink_rate' | 'long_blinks' | 'yawns' | 'nods', number | null>
>;

export class FatigueFuzzy {
  private sets = inputSets(0.4, 2, 3);

  setLimits(perclosLimit: number, drowsyS: number, yawnLimit = 3) {
    this.sets = inputSets(perclosLimit, Math.max(0.5, drowsyS), Math.max(2, Math.round(yawnLimit)));
  }

  evaluate(inputs: FuzzyInputs): FuzzyResult {
    const clipped: Partial<Record<Out, number>> = {};
    const fired: [string, Out, number][] = [];
    let worry = 0;
    const ordered = [...RULES].sort((a, b) => Number(a.out === 'low') - Number(b.out === 'low'));
    for (const r of ordered) {
      const mus = r.conds
        .map((cd) => {
          const x = inputs[cd.v as keyof FuzzyInputs];
          if (x === null || x === undefined) return null;
          const m = trap(x, this.sets[cd.v]![cd.term]!);
          return cd.not ? 1 - m : m;
        })
        .filter((m): m is number => m !== null);
      if (!mus.length) continue;
      let strength = Math.min(...mus);
      if (r.out === 'low') strength = Math.min(strength, 1 - worry);
      else worry = Math.max(worry, strength);
      if (strength > 0) {
        fired.push([r.label, r.out, strength]);
        clipped[r.out] = Math.max(clipped[r.out] ?? 0, strength);
      }
    }
    let score = 0;
    const outs = Object.entries(clipped) as [Out, number][];
    if (outs.length) {
      let num = 0;
      let den = 0;
      for (const x of XS) {
        const mu = Math.max(...outs.map(([o, s]) => Math.min(s, trap(x, OUTPUT[o]))));
        num += mu * x;
        den += mu;
      }
      score = den ? Math.round((num / den) * 1000) / 1000 : 0;
    }
    const level = (score > DROWSY_BAND ? 2 : score > WARNING_BAND ? 1 : 0) as 0 | 1 | 2;
    const worrying = fired.filter((f) => f[1] !== 'low');
    const rank = { high: 2, medium: 1, low: 0 };
    const top = worrying.sort((a, b) => Math.round(b[2] * 100) - Math.round(a[2] * 100) || rank[b[1]] - rank[a[1]])[0];
    return { score, level, category: CATEGORY[level]!, reason: top ? top[0] : '' };
  }
}

// ------------------------------------------------------------------ in-car alarm (fusion/watch_alerts.py)

export const NONE = 0;
export const MILD = 1;
export const HIGH = 2;

export interface FrameSigns {
  closedForS: number;
  perclos: number;
  nodded: boolean;
  awayForS: number;
  restless: boolean;
  fatigue: number;
  fatigueReason: string;
}

/**
 * Decides when to warn the driver: eyes closed past the microsleep limit or a nod → HIGH at once,
 * repeating every 3 s while the eyes stay closed; the backend's verdict and fuzzy fatigue in
 * between; offline, PERCLOS over the limit → HIGH. `fire(level, reason)` sounds it.
 */
export class InCarAlarm {
  repeatS = 15;
  closedRepeatS = 3;
  calmS = 3;
  offlineAfterS = 5;
  drowsyDurationS = 2;
  perclosThreshold = 0.4;
  awayS = 2;
  awayLongS = 5;
  reasonNow = '';
  private active = NONE;
  private lastSent: Record<number, number> = {};
  private seen: Record<number, number> = {};
  private backendAt: number | null = null;
  private backendLevel = NONE;
  private fuzzyLevel = NONE;

  constructor(private fire: (level: number, reason: string) => void) {}

  get level(): number {
    return this.active;
  }

  applyThresholds(t: { drowsyDurationMs?: number; perclosThreshold?: number }) {
    if (typeof t.drowsyDurationMs === 'number' && t.drowsyDurationMs > 0)
      this.drowsyDurationS = t.drowsyDurationMs / 1000;
    if (typeof t.perclosThreshold === 'number' && t.perclosThreshold > 0) this.perclosThreshold = t.perclosThreshold;
  }

  onBackend(classification: string, now: number) {
    this.backendAt = now;
    this.backendLevel = classification === 'drowsy' ? HIGH : classification === 'warning' ? MILD : NONE;
  }

  onFrame(s: FrameSigns, now: number): number {
    let level = NONE;
    let reason = '';
    if (s.closedForS >= this.drowsyDurationS) [level, reason] = [HIGH, `eyes closed ${s.closedForS.toFixed(1)}s`];
    else if (s.nodded) [level, reason] = [HIGH, 'head nod'];
    else if (s.awayForS >= this.awayLongS) [level, reason] = [HIGH, `eyes off the road ${Math.round(s.awayForS)}s`];
    else if (s.awayForS >= this.awayS) [level, reason] = [MILD, 'eyes off the road'];
    else if (s.restless) [level, reason] = [MILD, 'restless: too much movement'];
    const enter = s.fatigue > 0.7 ? HIGH : s.fatigue > 0.4 ? MILD : NONE;
    const stay = s.fatigue > 0.6 ? HIGH : s.fatigue > 0.3 ? MILD : NONE;
    this.fuzzyLevel = Math.max(enter, Math.min(this.fuzzyLevel, stay));
    if (this.fuzzyLevel > level) [level, reason] = [this.fuzzyLevel, `fatigue: ${s.fatigueReason || 'several signs'}`];
    const fresh = this.backendAt !== null && now - this.backendAt <= this.offlineAfterS;
    if (fresh && this.backendLevel > level) [level, reason] = [this.backendLevel, 'backend'];
    else if (!fresh && s.perclos >= this.perclosThreshold && HIGH > level)
      [level, reason] = [HIGH, `PERCLOS ${Math.round(s.perclos * 100)}% (offline)`];

    this.reasonNow = reason;
    if (level > NONE) this.seen[level] = now;
    const held = [HIGH, MILD].find((lv) => now - (this.seen[lv] ?? -1e9) < this.calmS) ?? NONE;
    if (level > this.active) {
      this.send(level, now, reason);
    } else if (held < this.active) {
      this.send(held, now, '');
    } else if (level > NONE && level === this.active) {
      const stillClosed = level === HIGH && s.closedForS >= this.drowsyDurationS;
      const every = stillClosed ? this.closedRepeatS : this.repeatS;
      if (stillClosed) reason = `eyes closed ${s.closedForS.toFixed(1)}s`;
      const last = this.lastSent[level];
      if (last === undefined || now - last >= every) this.send(level, now, reason);
    }
    return this.active;
  }

  private send(level: number, now: number, reason: string) {
    this.lastSent[level] = now;
    this.active = level;
    this.fire(level, reason);
  }
}
