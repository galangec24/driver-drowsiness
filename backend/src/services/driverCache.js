/**
 * Short-lived cache of Driver documents for the ingest hot path. Every car sends about one reading
 * per second, and each reading needs its driver's thresholds; without the cache that is one extra
 * MongoDB round trip per reading. Concurrent lookups for the same driver share one query.
 *
 * Entries are dropped as soon as a driver changes (hooks in models/Driver.js), so new thresholds
 * apply on the next reading. DRIVER_CACHE_MS bounds staleness if a change is made outside this
 * process (e.g. by hand in Atlas); 0 turns the cache off.
 */
const TTL_MS = Number(process.env.DRIVER_CACHE_MS ?? 30_000);
const MAX_ENTRIES = 5000;

const entries = new Map(); // driverId -> { promise, expiresAt }

/** The driver document, or null. Callers must treat it as read-only (it is shared). */
function get(driverId) {
  const id = String(driverId);
  const Driver = require('../models/Driver');
  if (!(TTL_MS > 0)) return Driver.findById(id);
  const now = Date.now();
  const hit = entries.get(id);
  if (hit && hit.expiresAt > now) return hit.promise;

  if (entries.size >= MAX_ENTRIES) entries.clear();
  const entry = { expiresAt: now + TTL_MS };
  entry.promise = Driver.findById(id).then(
    (driver) => {
      // Unknown ids are not remembered: a driver created a moment later must work at once.
      if (!driver && entries.get(id) === entry) entries.delete(id);
      return driver;
    },
    (err) => {
      if (entries.get(id) === entry) entries.delete(id);
      throw err;
    },
  );
  entries.set(id, entry);
  return entry.promise;
}

function invalidate(driverId) {
  entries.delete(String(driverId));
}

function clear() {
  entries.clear();
}

module.exports = { get, invalidate, clear };
