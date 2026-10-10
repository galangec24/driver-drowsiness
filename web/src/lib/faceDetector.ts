import type { FaceDetector } from '@mediapipe/tasks-vision';

/**
 * In-browser face detector (MediaPipe BlazeFace, ~230 KB model) used only to guide the driver
 * photo: is there one face, centred, close enough. Loaded on first use, never at app start; the
 * browser caches the runtime (~3.5 MB compressed) and the model afterwards.
 * The wasm version must match the installed @mediapipe/tasks-vision package.
 */
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

let loading: Promise<FaceDetector> | null = null;

async function create(): Promise<FaceDetector> {
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO' as const,
    minDetectionConfidence: 0.6,
  });
  try {
    return await FaceDetector.createFromOptions(fileset, options('GPU'));
  } catch {
    return FaceDetector.createFromOptions(fileset, options('CPU'));
  }
}

/** Shared detector; a failed load is retried the next time the camera opens. */
export function loadFaceDetector(): Promise<FaceDetector> {
  loading ??= create().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}
