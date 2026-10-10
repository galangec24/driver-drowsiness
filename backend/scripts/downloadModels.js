/**
 * Populate backend/models/ with the face-api.js weights (gitignored).
 * Copies from the @vladmandic/face-api package; no network access needed.
 */
const fs = require('fs');
const path = require('path');
const { MODEL_DIR, PACKAGE_MODEL_DIR } = require('../src/config/faceApi');
const logger = require('../src/config/logger');

const NETS = ['ssd_mobilenetv1_model', 'face_landmark_68_model', 'face_recognition_model'];

fs.mkdirSync(MODEL_DIR, { recursive: true });
for (const net of NETS) {
  for (const suffix of ['-weights_manifest.json', '.bin']) {
    const file = `${net}${suffix}`;
    fs.copyFileSync(path.join(PACKAGE_MODEL_DIR, file), path.join(MODEL_DIR, file));
  }
}
logger.info({ dir: MODEL_DIR, nets: NETS }, 'face models ready');
