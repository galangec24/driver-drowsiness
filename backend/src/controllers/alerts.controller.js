const { z } = require('zod');
const Alert = require('../models/Alert');
const Driver = require('../models/Driver');
const HttpError = require('../utils/httpError');
const alertDispatcher = require('../services/alertDispatcher');

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

const listQuerySchema = z.object({
  driverId: objectId.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  acknowledged: z.enum(['true', 'false']).optional(),
  type: z.enum(Alert.ALERT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

const ackSchema = z.object({
  acknowledgedBy: z.enum(['apk', 'web', 'unknown']).optional(),
  // Optional label: the parent says this alert was a false alarm (training data for ml/).
  falseAlarm: z.boolean().optional(),
});

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
  const filter = { parentId: req.user.parentId };
  if (q.driverId) filter.driverId = q.driverId;
  if (q.type) filter.type = q.type;
  if (q.acknowledged) filter.acknowledged = q.acknowledged === 'true';
  if (q.from || q.to) {
    filter.createdAt = {};
    if (q.from) filter.createdAt.$gte = new Date(q.from);
    if (q.to) filter.createdAt.$lte = new Date(q.to);
  }

  const [alerts, names, unacknowledged] = await Promise.all([
    Alert.find(filter).sort({ createdAt: -1 }).limit(q.limit),
    driverNames(req.user.parentId),
    Alert.countDocuments({ parentId: req.user.parentId, acknowledged: false }),
  ]);
  res.json({
    alerts: alerts.map((a) => a.toPublic({ driverName: names.get(a.driverId.toString()) || null })),
    unacknowledged,
  });
}

/** First acknowledge wins; later acks get the already-acknowledged alert back. */
async function acknowledge(req, res) {
  const acknowledgedBy = (req.body && req.body.acknowledgedBy) || 'unknown';
  const falseAlarm = req.body ? req.body.falseAlarm : undefined;
  const update = { acknowledged: true, acknowledgedAt: new Date(), acknowledgedBy };
  if (typeof falseAlarm === 'boolean') {
    update.feedback = { falseAlarm, by: acknowledgedBy, at: new Date() };
  }
  const updated = await Alert.findOneAndUpdate(
    { _id: req.params.id, parentId: req.user.parentId, acknowledged: false },
    update,
    { new: true },
  );

  if (updated) {
    alertDispatcher.dispatchAcknowledged(
      req.user.parentId,
      updated._id.toString(),
      acknowledgedBy,
      update.feedback ? falseAlarm : undefined,
    );
    return res.json({ alert: updated.toPublic(), alreadyAcknowledged: false });
  }

  const existing = await Alert.findOne({ _id: req.params.id, parentId: req.user.parentId });
  if (!existing) throw new HttpError(404, 'Alert not found');
  return res.json({ alert: existing.toPublic(), alreadyAcknowledged: true });
}

/** Label an alert (true / false alarm) at any time — e.g. after it was acknowledged elsewhere. */
async function feedback(req, res) {
  const by = req.body.by || 'unknown';
  const alert = await Alert.findOneAndUpdate(
    { _id: req.params.id, parentId: req.user.parentId },
    { feedback: { falseAlarm: req.body.falseAlarm, by, at: new Date() } },
    { new: true },
  );
  if (!alert) throw new HttpError(404, 'Alert not found');
  alertDispatcher.dispatchFeedback(req.user.parentId, alert._id.toString(), req.body.falseAlarm);
  res.json({ alert: alert.toPublic() });
}

module.exports = { list, acknowledge, feedback, listQuerySchema, ackSchema, feedbackSchema };
