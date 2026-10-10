const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');
const { FEATURE_NAMES } = require('./fpFeatures');

/**
 * False-positive verifier: gradient-boosted trees trained in ml/ (scripts/train.py) and exported
 * to src/ml/fp-verifier.json. Pure JS inference — the weights live only in the backend.
 * Features are cast to float32 before comparisons, exactly like scikit-learn's trees.
 */
const DEFAULT_MODEL_PATH = path.resolve(__dirname, '../ml/fp-verifier.json');

let model = null;

function validate(m) {
  if (m.kind !== 'gradient_boosted_trees') throw new Error(`unsupported model kind ${m.kind}`);
  if (JSON.stringify(m.features) !== JSON.stringify(FEATURE_NAMES)) {
    throw new Error('model feature list does not match fpFeatures.js — retrain or update the port');
  }
  return m;
}

function loadModel(file = DEFAULT_MODEL_PATH) {
  try {
    model = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
    logger.info(
      { trees: model.trees.length, threshold: model.threshold, version: model.version },
      'fp verifier loaded',
    );
  } catch (err) {
    model = null;
    logger.warn({ err: err.message }, 'fp verifier unavailable — alerts use fusion only');
  }
  return model;
}

function setModel(m) {
  model = m ? validate(m) : null;
}

function getModel() {
  return model;
}

/** Probability (0..1) that a candidate alert is a true drowsiness event. */
function predict(features, m = model) {
  if (!m) return null;
  const x = features.map((v) => Math.fround(v));
  let raw = m.init;
  for (const tree of m.trees) {
    let node = 0;
    while (tree.l[node] !== -1) {
      node = x[tree.f[node]] <= tree.t[node] ? tree.l[node] : tree.r[node];
    }
    raw += m.learningRate * tree.v[node];
  }
  return 1 / (1 + Math.exp(-raw));
}

module.exports = { loadModel, setModel, getModel, predict, DEFAULT_MODEL_PATH };
