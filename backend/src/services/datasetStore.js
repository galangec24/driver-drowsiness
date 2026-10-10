/**
 * What training data is available on this machine (ml/data) plus what lives in the database
 * (parent feedback labels). Read-only: datasets change only through admin jobs and uploads.
 */
const fs = require('fs');
const path = require('path');
const { env } = require('../config/env');
const { CATALOG } = require('../config/datasetCatalog');
const Alert = require('../models/Alert');
const ModelRelease = require('../models/ModelRelease');
const { eyeDir } = require('./trainingRunner');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.avi', '.mkv', '.m4v']);
const dataDir = (...p) => path.join(env.ml.mlDir, 'data', ...p);

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function countFiles(dir, pred, limit = 100_000) {
  let n = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (n >= limit) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (pred(e.name)) n += 1;
    }
  };
  walk(dir);
  return n;
}

/** Imported recording datasets (ml/data/recordings_<name>) usable as --extra for the verifier. */
function recordingSets() {
  let entries = [];
  try {
    entries = fs.readdirSync(dataDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith('recordings_'))
    .map((e) => {
      const drivers = readJsonSafe(dataDir(e.name, 'drivers.json'));
      const stats = readJsonSafe(dataDir(e.name, 'stats.json'));
      return {
        name: e.name.slice('recordings_'.length),
        drivers: drivers ? Object.keys(drivers).length : null,
        rows: stats && stats.rows,
        sessions: stats && stats.sessions,
      };
    });
}

async function listDatasets() {
  const lastCalibration = await ModelRelease.findOne({ kind: 'yawn_threshold' })
    .sort({ createdAt: -1 })
    .select('summary createdAt');

  const catalog = CATALOG.map((ds) => {
    const local = {};
    if (ds.task === 'eye_state') {
      const stats = readJsonSafe(dataDir(eyeDir(ds.id), 'stats.json'));
      local.ready = Boolean(stats);
      if (stats)
        Object.assign(local, { images: stats.images, open: stats.open, closed: stats.closed });
    } else if (ds.task === 'yawn_calibration') {
      local.ready = true; // downloaded on demand by the calibration job
      local.lastCalibrated =
        lastCalibration && lastCalibration.summary.dataset === ds.slug
          ? lastCalibration.createdAt
          : null;
    } else if (ds.task === 'video') {
      const folder = path.join(env.ml.videosDir, ds.id);
      local.folder = folder;
      local.videos = fs.existsSync(folder)
        ? countFiles(folder, (n) => VIDEO_EXT.has(path.extname(n).toLowerCase()))
        : 0;
      local.processed = fs.existsSync(dataDir(`recordings_${ds.id}`));
      local.ready = local.videos > 0;
    }
    return { ...ds, local };
  });

  const [labelled, falseAlarms, withWindow] = await Promise.all([
    Alert.countDocuments({ 'feedback.falseAlarm': { $exists: true } }),
    Alert.countDocuments({ 'feedback.falseAlarm': true }),
    Alert.countDocuments({
      'feedback.falseAlarm': { $exists: true },
      'verifier.window.0': { $exists: true },
    }),
  ]);

  return {
    catalog,
    synthetic: {
      main: readJsonSafe(dataDir('synthetic_v1', 'stats.json')),
      shift: readJsonSafe(dataDir('synthetic_shift', 'stats.json')),
    },
    recordings: recordingSets(),
    uploads: countFiles(dataDir('raw', 'uploads'), (n) => n.endsWith('.jsonl')),
    feedback: { labelled, falseAlarms, realAlarms: labelled - falseAlarms, withWindow },
    videosDir: env.ml.videosDir,
  };
}

/** Save an uploaded driver_monitor recording (.jsonl, one reading per line) to ml/data/raw/uploads. */
function saveUpload(name, content) {
  const safe = String(name)
    .replace(/\.jsonl$/i, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 60);
  if (!safe) throw new Error('invalid file name');
  const lines = String(content)
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) throw new Error('the file is empty');
  for (const [i, line] of lines.entries()) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1} is not JSON`);
    }
    if (typeof row.t !== 'number')
      throw new Error(
        `line ${i + 1} has no "t" (time) field. Is this a driver_monitor --record file?`,
      );
  }
  const dir = dataDir('raw', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safe}.jsonl`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return { file: path.basename(file), rows: lines.length };
}

module.exports = { listDatasets, recordingSets, saveUpload };
