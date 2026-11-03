/**
 * Alert photos are deleted with their alert:
 *   - removing an alert in the apps deletes its photo at once (alerts.controller → forgetPhotos);
 *     the alert record itself stays hidden (it still trains the false-alarm verifier);
 *   - deleting a driver deletes all their photos (drivers.controller);
 *   - anything else (alerts deleted straight in the database, a failed delete) is caught by the
 *     clean-up here: at server start and once a day, every stored alert photo whose alert no
 *     longer exists, or was removed, is deleted (Cloudinary, or backend/uploads in local dev).
 */
const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const logger = require('../config/logger');
const media = require('./mediaStorage');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Delete the photos of these alerts and clear their snapshotUrl. Never throws. */
async function forgetPhotos(alerts) {
  const withPhoto = alerts.filter((a) => a.snapshotUrl);
  if (!withPhoto.length) return 0;
  await Promise.all(
    withPhoto.map((a) => media.removeAlertSnapshot(String(a.driverId), String(a._id))),
  );
  await Alert.updateMany(
    { _id: { $in: withPhoto.map((a) => a._id) } },
    { $unset: { snapshotUrl: 1 } },
  ).catch(() => {});
  return withPhoto.length;
}

/** Delete stored photos whose alert is gone or removed. Returns how many were deleted. */
async function cleanupOrphanSnapshots() {
  const stored = await media.listAlertSnapshots();
  if (!stored.length) return 0;
  const ids = stored
    .map((s) => s.alertId)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const live = new Set(
    (
      await Alert.find({ _id: { $in: ids }, removedAt: null })
        .select('_id')
        .lean()
    ).map((a) => String(a._id)),
  );
  const orphans = stored.filter((s) => !live.has(s.alertId));
  for (const o of orphans) await media.removeAlertSnapshot(o.driverId, o.alertId);
  if (orphans.length) logger.info({ deleted: orphans.length }, 'orphaned alert photos deleted');
  return orphans.length;
}

/** Clean up now and once a day (unref'd: never keeps the process alive). Returns a stopper. */
function schedule(everyMs = DAY_MS) {
  const tick = () =>
    cleanupOrphanSnapshots().catch((err) =>
      logger.warn({ err: err.message }, 'alert photo clean-up failed'),
    );
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

module.exports = { forgetPhotos, cleanupOrphanSnapshots, schedule };
