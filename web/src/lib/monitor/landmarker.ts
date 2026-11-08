import type { FaceLandmarker } from '@mediapipe/tasks-vision';

/**
 * TESTING PHASE: MediaPipe FaceLandmarker (478 points + head pose matrix): the same model as the
 * in-car monitor (driver_monitor/models/face_landmarker.task). Loaded only on the monitor page.
 * The wasm version must match the installed @mediapipe/tasks-vision package (as lib/faceDetector.ts).
 */
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let loading: Promise<FaceLandmarker> | null = null;

async function create(): Promise<FaceLandmarker> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO' as const,
    // A passenger may be in view too: up to 3 faces, the driver is the largest (closest).
    numFaces: 3,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFacialTransformationMatrixes: true,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    return FaceLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

export function loadLandmarker(): Promise<FaceLandmarker> {
  loading ??= create().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}
