const { z } = require('zod');
// Parent feedback changes the driver's sensitivity: re-tune right away, not at the next hourly run.
const { retuneSoon } = require('../services/adaptiveTuner');
const Alert = require('../models/Alert');
const Driver = require('../models/Driver');
const HttpError = require('../utils/httpError');
const alertDispatcher = require('../services/alertDispatcher');
const { startOfLocalDay, isExpired } = require('../utils/alertDay');

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

const listQuerySchema = z.object({
  driverId: objectId.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  acknowledged: z.enum(['true', 'false']).optional(),
  // open = still to acknowledge today · acknowledged · expired = not acknowledged on its day
  status: z.enum(['open', 'acknowledged', 'expired']).optional(),
  // Notifications: unread / read
  read: z.enum(['true', 'false']).optional(),
  type: z.enum(Alert.ALERT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

const ackSchema = z.object({
  acknowledgedBy: z.enum(['apk', 'web', 'unknown']).optional(),
  // Optional label: the parent says this alert was a false alarm (training data for ml/).
  falseAlarm: z.boolean().optional(),
});

const readSchema = z.object({ read: z.boolean().optional().default(true) });
const readAllSchema = z.object({ driverId: objectId.optional() });
const removeSchema = z
  .object({
    ids: z.array(objectId).min(1).max(500).optional(),
    // Remove every expired (never acknowledged) alert at once.
    expired: z.literal(true).optional(),
  })
  .refine((b) => b.ids || b.expired, { message: 'ids or expired is required' });

const EXPIRED_MESSAGE =
  'This alert is from a previous day and can no longer be acknowledged. You can remove it.';

const feedbackSchema = z.object({
  falseAlarm: z.boolean(),
  by: z.enum(['apk', 'web', 'unknown']).optional(),
});

async function driverNames(parentId) {
  const drivers = await Driver.find({ parentId }).select('name').lean();
  return new Map(drivers.map((d) => [d._id.toString(), d.name]));
}

async function list(req, res) {
  const q = req.validQuery;
  const today = startOfLocalDay();
  const mine = { parentId: req.user.parentId, removedAt: null };
  const filter = { ...mine };
  if (q.driverId) filter.driverId = q.driverId;
  if (q.type) filter.type = q.type;
  if (q.acknowledged) filter.acknowledged = q.acknowledged === 'true';
  if (q.read) filter.readAt = q.read === 'true' ? { $ne: null } : null;
  const range = {};
  if (q.from) range.$gte = new Date(q.from);
  if (q.to) range.$lte = new Date(q.to);
  if (q.status === 'acknowledged') filter.acknowledged = true;
  if (q.status === 'open') {
    filter.acknowledged = false;
    range.$gte = range.$gte && range.$gte > today ? range.$gte : today;
  }
  if (q.status === 'expired') {
    filter.acknowledged = false;
    range.$lt = today;
  }
  if (Object.keys(range).length) filter.createdAt = range;

  const [alerts, names, unacknowledged, unread, expired] = await Promise.all([
    Alert.find(filter).sort({ createdAt: -1 }).limit(q.limit),
    driverNames(req.user.parentId),
    // Still to acknowledge (today's): the badge on "Alerts".
    Alert.countDocuments({ ...mine, acknowledged: false, createdAt: { $gte: today } }),
    // Unread notifications: the badge on the bell.
    Alert.countDocuments({ ...mine, readAt: null }),
    Alert.countDocuments({ ...mine, acknowledged: false, createdAt: { $lt: today } }),
  ]);
  res.json({
    alerts: alerts.map((a) => a.toPublic({ driverName: names.get(a.driverId.toString()) || null })),
    unacknowledged,
    unread,
    expired,
  });
}

/** Mark one notification read (or unread again). */
async function markRead(req, res) {
  const alert = await Alert.findOneAndUpdate(
    { _id: req.params.id, parentId: req.user.parentId, removedAt: null },
    req.body.read ? { readAt: new Date() } : { $unset: { readAt: 1 } },
    { new: true },
  );
  if (!alert) throw new HttpError(404, 'Alert not found');
  alertDispatcher.dispatchRead(req.user.parentId, [alert._id.toString()], req.body.read);
  res.json({ alert: alert.toPublic() });
}

async function markAllRead(req, res) {
  const filter = { parentId: req.user.parentId, removedAt: null, readAt: null };
  if (req.body.driverId) filter.driverId = req.body.driverId;
  const ids = (await Alert.find(filter).select('_id').lean()).map((a) => a._id.toString());
  if (ids.length) {
    await Alert.updateMany({ _id: { $in: ids } }, { readAt: new Date() });
    alertDispatcher.dispatchRead(req.user.parentId, ids, true);
  }
  res.json({ updated: ids.length });
}

/** Remove alerts from the parent's lists (any state; expired ones in bulk). */
async function remove(req, res) {
  const ids = req.params.id ? [req.params.id] : req.body.ids;
  const filter = { parentId: req.user.parentId, removedAt: null };
  if (ids) filter._id = { $in: ids };
  if (!req.params.id && req.body.expired) {
    filter.acknowledged = false;
    filter.createdAt = { $lt: startOfLocalDay() };
  }
  const found = (await Alert.find(filter).select('_id').lean()).map((a) => a._id.toString());
  if (req.params.id && !found.length) throw new HttpError(404, 'Alert not found');
  if (found.length) {
    await Alert.updateMany({ _id: { $in: found } }, { removedAt: new Date() });
    alertDispatcher.dispatchRemoved(req.user.parentId, found);
  }
  res.json({ removed: found.length, alertIds: found });
}

/** First acknowledge wins; later acks get the already-acknowledged alert back. */
async function acknowledge(req, res) {
  const acknowledgedBy = (req.body && req.body.acknowledgedBy) || 'unknown';
  const falseAlarm = req.body ? req.body.falseAlarm : undefined;
  const update = {
    acknowledged: true,
    acknowledgedAt: new Date(),
    acknowledgedBy,
    readAt: new Date(),
  };
  if (typeof falseAlarm === 'boolean') {
    update.feedback = { falseAlarm, by: acknowledgedBy, at: new Date() };
  }
  // Only today's alerts can be acknowledged (the createdAt bound makes the check atomic).
  const updated = await Alert.findOneAndUpdate(
    {
      _id: req.params.id,
      parentId: req.user.parentId,
      removedAt: null,
      acknowledged: false,
      createdAt: { $gte: startOfLocalDay() },
    },
    update,
    { new: true },
  );

  if (updated) {
    if (update.feedback) retuneSoon(updated.driverId);
    alertDispatcher.dispatchAcknowledged(
      req.user.parentId,
      updated._id.toString(),
      acknowledgedBy,
      update.feedback ? falseAlarm : undefined,
    );
    return res.json({ alert: updated.toPublic(), alreadyAcknowledged: false });
  }

  const existing = await Alert.findOne({
    _id: req.params.id,
    parentId: req.user.parentId,
    removedAt: null,
  });
  if (!existing) throw new HttpError(404, 'Alert not found');
  if (isExpired(existing)) throw new HttpError(409, EXPIRED_MESSAGE);
  return res.json({ alert: existing.toPublic(), alreadyAcknowledged: true });
}

/** Label an alert (true / false alarm) at any time — e.g. after it was acknowledged elsewhere. */
async function feedback(req, res) {
  const by = req.body.by || 'unknown';
  const current = await Alert.findOne({
    _id: req.params.id,
    parentId: req.user.parentId,
    removedAt: null,
  });
  if (!current) throw new HttpError(404, 'Alert not found');
  if (isExpired(current)) throw new HttpError(409, EXPIRED_MESSAGE);
  const alert = await Alert.findOneAndUpdate(
    { _id: req.params.id, parentId: req.user.parentId },
    { feedback: { falseAlarm: req.body.falseAlarm, by, at: new Date() } },
    { new: true },
  );
  if (!alert) throw new HttpError(404, 'Alert not found');
  retuneSoon(alert.driverId);
  alertDispatcher.dispatchFeedback(req.user.parentId, alert._id.toString(), req.body.falseAlarm);
  res.json({ alert: alert.toPublic() });
}

module.exports = {
  list,
  acknowledge,
  feedback,
  markRead,
  markAllRead,
  remove,
  listQuerySchema,
  ackSchema,
  feedbackSchema,
  readSchema,
  readAllSchema,
  removeSchema,
};
