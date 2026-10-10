/** In-memory latest status per driver (live view only — history lives in SensorLog). */
const latest = new Map();

function set(driverId, status) {
  latest.set(driverId, status);
}

function get(driverId) {
  return latest.get(driverId) || null;
}

function clear() {
  latest.clear();
}

module.exports = { set, get, clear };
