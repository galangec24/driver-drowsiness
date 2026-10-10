import { describe, expect, it } from 'vitest';
import { checkPosition, ovalFor, videoBoxToDisplay, yawFromKeypoints, type SeenFace } from './facePosition';

// A portrait phone viewfinder.
const W = 390;
const H = 700;
const oval = ovalFor(W, H);

/** A face of the given width (share of the oval width), centred on the oval unless moved. */
function face(fill: number, { dx = 0, dy = 0, yaw = 0 } = {}): SeenFace {
  const w = oval.rx * 2 * fill;
  const h = w * 1.1;
  return { box: { x: oval.cx - w / 2 + dx, y: oval.cy - h / 2 + dy, w, h }, yaw };
}

describe('ovalFor', () => {
  it('fills most of a portrait phone screen', () => {
    expect(oval.rx * 2).toBeGreaterThan(W * 0.75);
    expect(oval.ry * 2).toBeLessThanOrEqual(H * 0.72 + 0.001);
  });

  it('is limited by height on a wide screen', () => {
    const o = ovalFor(800, 600);
    expect(o.ry).toBeCloseTo(600 * 0.36);
    expect(o.rx).toBeCloseTo(o.ry * 0.75);
  });
});

describe('checkPosition', () => {
  it('accepts one centred face at the right distance', () => {
    expect(checkPosition([face(0.7)], oval, 'front')).toEqual([]);
  });

  it('asks for exactly one face', () => {
    expect(checkPosition([], oval, 'front')).toEqual(['no_face']);
    expect(checkPosition([face(0.7), face(0.5)], oval, 'front')).toEqual(['multiple_faces']);
  });

  it('checks the distance from the camera', () => {
    expect(checkPosition([face(0.3)], oval, 'front')).toContain('face_too_small');
    expect(checkPosition([face(1.2)], oval, 'front')).toContain('face_too_big');
  });

  it('wants the face centred in the oval', () => {
    expect(checkPosition([face(0.7, { dx: oval.rx * 0.6 })], oval, 'front')).toContain('off_center');
    expect(checkPosition([face(0.7, { dy: -oval.ry * 0.5 })], oval, 'front')).toContain('off_center');
    expect(checkPosition([face(0.7, { dx: oval.rx * 0.1 })], oval, 'front')).toEqual([]);
  });

  it('front needs a straight look; left/right need a turned head', () => {
    expect(checkPosition([face(0.7, { yaw: 0.35 })], oval, 'front')).toEqual(['look_straight']);
    expect(checkPosition([face(0.7, { yaw: 0.02 })], oval, 'left')).toEqual(['turn_head']);
    expect(checkPosition([face(0.7, { yaw: -0.3 })], oval, 'right')).toEqual([]);
    expect(checkPosition([face(0.7, { yaw: 0.3 })], oval, 'left')).toEqual([]);
  });
});

describe('videoBoxToDisplay', () => {
  it('maps a centred box through object-fit: cover cropping', () => {
    // 1280×720 landscape video in a 390×700 portrait frame: scaled by 700/720, sides cropped.
    const b = videoBoxToDisplay({ x: 540, y: 260, w: 200, h: 200 }, 1280, 720, W, H, false);
    const scale = 700 / 720;
    expect(b.w).toBeCloseTo(200 * scale);
    expect(b.x + b.w / 2).toBeCloseTo(W / 2);
    expect(b.y + b.h / 2).toBeCloseTo(H / 2);
  });

  it('mirrors like the selfie preview', () => {
    const plain = videoBoxToDisplay({ x: 100, y: 100, w: 100, h: 100 }, 640, 480, 640, 480, false);
    const mirrored = videoBoxToDisplay({ x: 100, y: 100, w: 100, h: 100 }, 640, 480, 640, 480, true);
    expect(plain.x).toBeCloseTo(100);
    expect(mirrored.x).toBeCloseTo(640 - 200);
  });
});

describe('yawFromKeypoints', () => {
  it('is ~0 facing the camera and grows as the head turns', () => {
    const eyes = [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
    ];
    expect(yawFromKeypoints([...eyes, { x: 0.5, y: 0.5 }])).toBeCloseTo(0);
    expect(Math.abs(yawFromKeypoints([...eyes, { x: 0.57, y: 0.5 }]))).toBeCloseTo(0.35);
    expect(yawFromKeypoints([])).toBe(0);
  });
});
