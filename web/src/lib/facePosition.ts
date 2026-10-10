/**
 * Is the face placed well inside the on-screen guide oval? Pure geometry so it can be unit-tested;
 * the face boxes come from the in-browser MediaPipe detector (see lib/faceDetector.ts). This only
 * guides the photo; recognition still happens on the backend.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Oval {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface SeenFace {
  /** Face box in viewfinder (display) pixels. */
  box: Box;
  /** Head turn: nose offset from the eye midpoint, in eye-distances (0 = facing the camera). */
  yaw: number;
}

export type PositionIssue =
  'no_face' | 'multiple_faces' | 'face_too_small' | 'face_too_big' | 'off_center' | 'look_straight' | 'turn_head';

/** Face width as a share of the oval width that counts as "the right distance". */
const MIN_FILL = 0.45;
const MAX_FILL = 1.0;
/** How far (in oval radii) the face centre may drift from the oval centre. */
const MAX_OFFSET = 0.35;
const FRONT_MAX_YAW = 0.2;
const SIDE_MIN_YAW = 0.15;

/** The guide oval for a viewfinder of W×H: as large as fits, 3:4, slightly above centre. */
export function ovalFor(W: number, H: number): Oval {
  const ry = Math.min(H * 0.36, ((W * 0.84) / 2) * (4 / 3));
  return { cx: W / 2, cy: H * 0.47, rx: ry * 0.75, ry };
}

/**
 * Map a box in video pixels to viewfinder pixels for a video drawn with `object-fit: cover`
 * (centre-cropped), optionally mirrored like a selfie preview.
 */
export function videoBoxToDisplay(b: Box, vw: number, vh: number, W: number, H: number, mirror = true): Box {
  const scale = Math.max(W / vw, H / vh);
  const offX = (vw * scale - W) / 2;
  const offY = (vh * scale - H) / 2;
  const x = b.x * scale - offX;
  const w = b.w * scale;
  return { x: mirror ? W - x - w : x, y: b.y * scale - offY, w, h: b.h * scale };
}

/** Yaw from normalised keypoints [rightEye, leftEye, noseTip, …] (MediaPipe BlazeFace order). */
export function yawFromKeypoints(kp: Array<{ x: number; y: number }>): number {
  const [r, l, nose] = kp;
  if (!r || !l || !nose) return 0;
  const eyeDist = Math.hypot(l.x - r.x, l.y - r.y);
  if (!eyeDist) return 0;
  return (nose.x - (r.x + l.x) / 2) / eyeDist;
}

/** Everything that keeps this frame from being a good enrollment photo ([] = good). */
export function checkPosition(faces: SeenFace[], oval: Oval, angle: string): PositionIssue[] {
  if (faces.length === 0) return ['no_face'];
  if (faces.length > 1) return ['multiple_faces'];
  const { box, yaw } = faces[0]!;
  const issues: PositionIssue[] = [];
  const fill = box.w / (oval.rx * 2);
  if (fill < MIN_FILL) issues.push('face_too_small');
  else if (fill > MAX_FILL) issues.push('face_too_big');
  const dx = (box.x + box.w / 2 - oval.cx) / oval.rx;
  const dy = (box.y + box.h / 2 - oval.cy) / oval.ry;
  if (Math.hypot(dx, dy) > MAX_OFFSET) issues.push('off_center');
  if (angle === 'front' && Math.abs(yaw) > FRONT_MAX_YAW) issues.push('look_straight');
  if (angle !== 'front' && Math.abs(yaw) < SIDE_MIN_YAW) issues.push('turn_head');
  return issues;
}
