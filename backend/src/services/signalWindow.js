/**
 * Rolling per-driver window of recent ticks (in memory) for the false-positive verifier.
 * Holds the same values that are persisted to SensorLog; after a restart the verifier
 * abstains until MIN_TICKS of history have arrived again.
 */
const { WINDOW } = require('./fpFeatures');

const windows = new Map();

function push(driverId, tick) {
  let w = windows.get(driverId);
  if (!w) {
    w = [];
    windows.set(driverId, w);
  }
  // A long gap (driver stopped, monitor restarted) starts a fresh window.
  const last = w[w.length - 1];
  if (last && tick.t - last.t > 60000) w.length = 0;
  w.push(tick);
  if (w.length > WINDOW) w.shift();
  return w;
}

function get(driverId) {
  return windows.get(driverId) || [];
}

function clear() {
  windows.clear();
}

module.exports = { push, get, clear };
