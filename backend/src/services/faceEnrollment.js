const { loadFaceModels } = require('../config/faceApi');
const HttpError = require('../utils/httpError');
const { base64ToBuffer, decodeImage, regionQuality } = require('./imageDecoder');
const { euclidean } = require('./faceMatcher');

// Quality heuristics (image capture quality — not drowsiness thresholds).
const MIN_SHARPNESS = 60; // variance of Laplacian inside the face box
const MIN_BRIGHTNESS = 50;
const MAX_BRIGHTNESS = 215;
const MIN_FACE_RATIO = 0.12; // face width / image width
// Photos of one enrollment must be the same person (a bit looser than the match distance
// because enrollment deliberately mixes front/left/right angles).
const SAME_PERSON_DISTANCE = 0.65;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** Score 0..1 plus human-readable issues for one detected face. */
function scoreQuality({ detectionScore, sharpness, brightness, faceRatio }) {
  const issues = [];
  if (sharpness < MIN_SHARPNESS) issues.push('blurry');
  if (brightness < MIN_BRIGHTNESS) issues.push('too_dark');
  if (brightness > MAX_BRIGHTNESS) issues.push('too_bright');
  if (faceRatio < MIN_FACE_RATIO) issues.push('face_too_small');

  const sharpF = clamp01(sharpness / (MIN_SHARPNESS * 2));
  const lightF =
    brightness < MIN_BRIGHTNESS
      ? clamp01(brightness / MIN_BRIGHTNESS)
      : brightness > MAX_BRIGHTNESS
        ? clamp01((255 - brightness) / (255 - MAX_BRIGHTNESS))
        : 1;
  const sizeF = clamp01(faceRatio / (MIN_FACE_RATIO * 2));
  const quality =
    clamp01(detectionScore) * (0.4 + 0.6 * sharpF) * (0.5 + 0.5 * lightF) * (0.6 + 0.4 * sizeF);
  return { quality: Math.round(quality * 1000) / 1000, issues };
}

/** Average descriptors then L2-normalise to the scale face-api descriptors live on. */
function averageDescriptors(descriptors) {
  if (!descriptors.length) return [];
  const len = descriptors[0].length;
  const avg = new Array(len).fill(0);
  for (const d of descriptors) for (let i = 0; i < len; i += 1) avg[i] += d[i] / descriptors.length;
  // face-api descriptors have norm ≈ 1; keep the average on that scale.
  const meanNorm = descriptors.reduce((s, d) => s + Math.hypot(...d), 0) / descriptors.length || 1;
  const norm = Math.hypot(...avg) || 1;
  return avg.map((v) => (v / norm) * meanNorm);
}

/**
 * Detect the most prominent face in a base64 photo and extract its 128-d descriptor.
 * @returns {{descriptor:number[], quality:number, issues:string[], buffer:Buffer, format:string, faces:number}}
 */
async function analyzePhoto(base64) {
  const faceapi = await loadFaceModels();
  const img = decodeImage(base64ToBuffer(base64));
  const tensor = faceapi.tf.tensor3d(img.rgb, [img.height, img.width, 3], 'int32');
  let results;
  try {
    results = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
  } finally {
    tensor.dispose();
  }

  if (!results.length) throw new HttpError(422, 'No face detected in photo');
  // Largest face wins (the person being enrolled is closest to the camera).
  const best = results.reduce((a, b) => (b.detection.box.area > a.detection.box.area ? b : a));
  const box = best.detection.box;
  const { sharpness, brightness } = regionQuality(img.gray, img.width, img.height, box);
  const { quality, issues } = scoreQuality({
    detectionScore: best.detection.score,
    sharpness,
    brightness,
    faceRatio: box.width / img.width,
  });
  if (results.length > 1) issues.push('multiple_faces');

  return {
    descriptor: Array.from(best.descriptor),
    quality,
    issues,
    buffer: img.buffer,
    format: img.format,
    faces: results.length,
  };
}

/**
 * Enroll a driver from 1–3 photos (front, left, right). Returns { embedding, quality, photos }.
 * The embedding must never be sent to a client.
 */
async function enrollPhotos(photos) {
  if (!Array.isArray(photos) || photos.length === 0) {
    throw new HttpError(400, 'At least one photo is required');
  }
  const analyzed = [];
  for (let i = 0; i < photos.length; i += 1) {
    try {
      analyzed.push(await analyzePhoto(photos[i]));
    } catch (err) {
      if (err instanceof HttpError) {
        throw new HttpError(err.status, `Photo ${i + 1}: ${err.message}`);
      }
      throw err;
    }
    if (analyzed[i].faces > 1) {
      // The profile must be one person: a second face would be averaged into it.
      throw new HttpError(
        422,
        `Photo ${i + 1}: more than one face. Only the driver should be in the photo`,
      );
    }
  }

  for (let i = 1; i < analyzed.length; i += 1) {
    const d = euclidean(analyzed[0].descriptor, analyzed[i].descriptor);
    if (d > SAME_PERSON_DISTANCE) {
      throw new HttpError(422, `Photo ${i + 1} does not appear to be the same person as photo 1`);
    }
  }

  const embedding = averageDescriptors(analyzed.map((a) => a.descriptor));
  const quality =
    Math.round((analyzed.reduce((s, a) => s + a.quality, 0) / analyzed.length) * 1000) / 1000;

  return {
    embedding,
    quality,
    reference: { buffer: analyzed[0].buffer, format: analyzed[0].format },
    photos: analyzed.map((a, i) => ({ index: i, quality: a.quality, issues: a.issues })),
  };
}

module.exports = {
  analyzePhoto,
  enrollPhotos,
  scoreQuality,
  averageDescriptors,
  SAME_PERSON_DISTANCE,
};
