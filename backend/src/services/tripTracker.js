/**
 * Drive tracking: how far and how long the driver had been driving when the first alert came.
 *
 * A drive starts with the first reading after the car has been silent for `TRIP_GAP_MS` (camera
 * off, driver out of the car for a while). Every reading with a GPS fix adds the straight-line
 * distance from the previous fix. The first alert of a drive gets a `trip` summary:
 * { startedAt, distanceKm, minutes, startLocation } ("12.4 km / 25 min after the drive started").
 *
 * GPS noise is filtered: fixes worse than 100 m, jumps faster than 250 km/h and tiny moves while
 * parked are ignored, so a car standing still doesn't "drive" a few hundred metres.
 *
 * Kept in memory (one small object per driver). After a server restart the part of the drive before
 * the restart is rebuilt from the stored readings (SensorLog) when the first alert comes.
 */
const SensorLog = require('../models/SensorLog');

const TRIP_GAP_MS = 15 * 60 * 1000;
const MAX_ACCURACY_M = 100;
const MAX_SPEED_KMH = 250;
// Below this move (metres) with no GPS speed, the car is treated as standing still (GPS jitter).
const MIN_MOVE_M = 15;
const REBUILD_LOOKBACK_MS = 12 * 60 * 60 * 1000;

const trips = new Map(); // driverId → trip

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function usable(loc) {
  return (
    loc &&
    typeof loc.lat === 'number' &&
    typeof loc.lng === 'number' &&
    !(typeof loc.accuracy === 'number' && loc.accuracy > MAX_ACCURACY_M)
  );
}

/** Distance (km) from fix `prev` (at prevT) to fix `loc` (at t) that counts, else 0. */
function step(prev, prevT, loc, t) {
  const km = haversineKm(prev, loc);
  const hours = (t - prevT) / 3_600_000;
  if (hours > 0 && km / hours > MAX_SPEED_KMH) return 0; // GPS jump
  const standing = typeof loc.speed === 'number' ? loc.speed < 3 : true;
  if (standing && km * 1000 < MIN_MOVE_M) return 0;
  return km;
}

function newTrip(t, loc, known) {
  return {
    startedAt: t,
    lastAt: t,
    startLocation: usable(loc) ? loc : null,
    lastFix: usable(loc) ? { loc, t } : null,
    distanceKm: 0,
    alerted: false,
    // No earlier reading of this driver in memory: the drive may have started before a restart.
    resumed: !known,
  };
}

/** Every reading (in time order). `t` in ms, `loc` the normalised fix or null. */
function update(driverId, t, loc) {
  const trip = trips.get(driverId);
  if (!trip || t - trip.lastAt > TRIP_GAP_MS) {
    trips.set(driverId, newTrip(t, loc, Boolean(trip)));
    return;
  }
  if (t < trip.lastAt) return; // late (queued) reading of the past: doesn't change the drive
  trip.lastAt = t;
  if (!usable(loc)) return;
  if (!trip.startLocation) trip.startLocation = loc;
  if (trip.lastFix) trip.distanceKm += step(trip.lastFix.loc, trip.lastFix.t, loc, t);
  trip.lastFix = { loc, t };
}

/** Readings stored before `before` that belong to the same drive (gap < TRIP_GAP_MS). */
async function earlierPart(driverId, before) {
  const logs = await SensorLog.find({
    driverId,
    createdAt: { $lt: new Date(before), $gte: new Date(before - REBUILD_LOOKBACK_MS) },
  })
    .sort({ createdAt: -1 })
    .select('createdAt location')
    .lean();
  const part = [];
  let next = before;
  for (const l of logs) {
    const t = new Date(l.createdAt).getTime();
    if (next - t > TRIP_GAP_MS) break;
    part.push({ t, loc: l.location || null });
    next = t;
  }
  return part.reverse();
}

/**
 * The first alert of the current drive: its summary, or null (not the first, or no drive known).
 * Marks the drive as alerted.
 */
async function firstAlert(driverId, t) {
  const trip = trips.get(driverId);
  if (!trip || trip.alerted) return null;
  trip.alerted = true;
  if (trip.resumed) {
    trip.resumed = false;
    try {
      const part = await earlierPart(driverId, trip.startedAt);
      if (part.length) {
        let km = 0;
        let fix = null;
        let start = null;
        for (const { t: pt, loc } of part) {
          if (!usable(loc)) continue;
          if (!start) start = loc;
          if (fix) km += step(fix.loc, fix.t, loc, pt);
          fix = { loc, t: pt };
        }
        if (fix && trip.startLocation) km += step(fix.loc, fix.t, trip.startLocation, trip.startedAt);
        trip.distanceKm += km;
        trip.startedAt = part[0].t;
        trip.startLocation = start || trip.startLocation;
      }
    } catch {
      // Database unavailable: keep what was seen since the restart.
    }
  }
  return summary(trip, t);
}

function summary(trip, t) {
  return {
    startedAt: new Date(trip.startedAt),
    distanceKm: Math.round(trip.distanceKm * 10) / 10,
    minutes: Math.max(0, Math.round((t - trip.startedAt) / 60000)),
    ...(trip.startLocation && {
      startLocation: { lat: trip.startLocation.lat, lng: trip.startLocation.lng },
    }),
  };
}

function clear() {
  trips.clear();
}

module.exports = { update, firstAlert, clear, haversineKm, TRIP_GAP_MS };
