import { describe, expect, test } from 'vitest';
import { PerclosTracker, poseFromMatrix, eyeAspectRatio } from './detectors';
import { FatigueFuzzy, HIGH, InCarAlarm, NONE } from './fuzzy';

describe('web driver monitor (port of driver_monitor/)', () => {
  test('EAR: open eye ~0.3, closed ~0', () => {
    const eye = (h: number) => [
      { x: 0, y: 0 },
      { x: 1, y: -h },
      { x: 2, y: -h },
      { x: 3, y: 0 },
      { x: 2, y: h },
      { x: 1, y: h },
    ];
    expect(eyeAspectRatio(eye(0.45))).toBeCloseTo(0.3, 2);
    expect(eyeAspectRatio(eye(0.01))).toBeLessThan(0.01);
  });

  test('PERCLOS: closed relative to the driver’s own open eyes; blinks are left out', () => {
    const p = new PerclosTracker();
    let t = 0;
    for (; t < 3; t += 0.1) p.update(0.3, t); // calibrate on open eyes
    for (let i = 0; i < 3; i += 1, t += 0.1) p.update(0.05, t); // a 0.3 s blink
    for (let i = 0; i < 5; i += 1, t += 0.1) p.update(0.3, t);
    expect(p.value).toBe(0);
    for (let i = 0; i < 30; i += 1, t += 0.1) p.update(0.05, t); // 3 s closed
    expect(p.closedFor(t - 0.1)).toBeGreaterThanOrEqual(2.8);
    expect(p.value).toBeGreaterThan(0.3);
  });

  test('narrow eyes are not "closed": 60 % of the driver’s open EAR', () => {
    const p = new PerclosTracker();
    let t = 0;
    for (; t < 3; t += 0.1) p.update(0.2, t);
    for (let i = 0; i < 30; i += 1, t += 0.1) p.update(0.12, t);
    expect(p.closedFor(t)).toBe(0);
  });

  test('fuzzy: calm → low score; microsleep → drowsy', () => {
    const f = new FatigueFuzzy();
    expect(f.evaluate({ perclos: 0.02, closure_s: 0, nods: 0, yawns: 0 }).level).toBe(0);
    const asleep = f.evaluate({ perclos: 0.1, closure_s: 3, nods: 0, yawns: 0 });
    expect(asleep.level).toBe(2);
    expect(asleep.reason).toMatch(/microsleep/);
    expect(f.evaluate({ yawns: 3, perclos: 0.05, closure_s: 0, nods: 0, blink_rate: 15 }).level).toBe(1);
  });

  test('in-car alarm: eyes closed 2 s → HIGH, repeats every 3 s while closed, calms after', () => {
    const fired: number[] = [];
    const a = new InCarAlarm((lv) => fired.push(lv));
    const signs = (closed: number) => ({
      closedForS: closed,
      perclos: 0,
      nodded: false,
      awayForS: 0,
      restless: false,
      fatigue: 0,
      fatigueReason: '',
    });
    a.onBackend('alert', 0);
    let t = 0;
    for (; t <= 10; t += 0.1) {
      a.onBackend('alert', t);
      a.onFrame(signs(t >= 1 ? t - 1 : 0), t);
    }
    expect(fired[0]).toBe(HIGH);
    expect(fired.filter((l) => l === HIGH).length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 50; i += 1, t += 0.1) {
      a.onBackend('alert', t);
      a.onFrame(signs(0), t);
    }
    expect(a.level).toBe(NONE);
  });

  test('head pose: chin down is negative pitch', () => {
    const th = (20 * Math.PI) / 180; // rotate the face 20° about x, chin toward -y
    const m = [1, 0, 0, 0, 0, Math.cos(th), Math.sin(th), 0, 0, -Math.sin(th), Math.cos(th), 0, 0, 0, 0, 1];
    expect(poseFromMatrix(m).pitch).toBeCloseTo(-20, 1);
  });
});
