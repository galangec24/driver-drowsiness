const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Server-side face model loader (face-api.js on the TensorFlow.js WASM backend).
 * Weights live in backend/models/ (gitignored) — populate with `npm run models:download`.
 * Falls back to the copy bundled inside the npm package.
 */
const MODEL_DIR = path.resolve(__dirname, '../../models');
const PACKAGE_MODEL_DIR = path.join(
  path.dirname(require.resolve('@vladmandic/face-api/package.json')),
  'model',
);

let faceapi = null;
let loading = null;

function modelDir() {
  const marker = 'face_recognition_model-weights_manifest.json';
  return fs.existsSync(path.join(MODEL_DIR, marker)) ? MODEL_DIR : PACKAGE_MODEL_DIR;
}

async function loadFaceModels() {
  if (faceapi) return faceapi;
  if (loading) return loading;

  loading = (async () => {
    const started = Date.now();
    const tf = require('@tensorflow/tfjs');
    require('@tensorflow/tfjs-backend-wasm');
    await tf.setBackend('wasm');
    await tf.ready();

    const api = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
    const dir = modelDir();
    await api.nets.ssdMobilenetv1.loadFromDisk(dir);
    await api.nets.faceLandmark68Net.loadFromDisk(dir);
    await api.nets.faceRecognitionNet.loadFromDisk(dir);

    faceapi = api;
    logger.info({ backend: tf.getBackend(), dir, ms: Date.now() - started }, 'face models loaded');
    return api;
  })();

  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}

function isReady() {
  return faceapi !== null;
}

module.exports = { loadFaceModels, isReady, MODEL_DIR, PACKAGE_MODEL_DIR };
