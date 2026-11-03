/**
 * Read-only MongoDB views for reporting (admin console → Reports, MongoDB Compass, the capstone
 * write-up). A view stores only its pipeline: it is always current and costs nothing until read.
 * Created or updated at server start (ensureViews), so changing a pipeline here is enough.
 *
 *   alert_daily_summary      alerts per day × driver × type: count, repeats, acknowledged,
 *                            false alarms, average confidence
 *   driver_daily_activity    minutes monitored per day × driver, from the sensor_minutes
 *                            materialized view: drowsy / warning minutes, averages
 */
const mongoose = require('mongoose');
const { env } = require('./env');
const logger = require('./logger');

const day = (field) => ({
  $dateToString: { format: '%Y-%m-%d', date: field, timezone: env.alertTimezone },
});

const VIEWS = {
  alert_daily_summary: {
    viewOn: 'alerts',
    pipeline: [
      { $match: { removedAt: null } },
      {
        $group: {
          _id: {
            day: day('$createdAt'),
            parentId: '$parentId',
            driverId: '$driverId',
            type: '$type',
          },
          alerts: { $sum: 1 },
          detections: { $sum: { $ifNull: ['$repeatCount', 1] } },
          acknowledged: { $sum: { $cond: ['$acknowledged', 1, 0] } },
          falseAlarms: { $sum: { $cond: [{ $eq: ['$feedback.falseAlarm', true] }, 1, 0] } },
          confirmed: { $sum: { $cond: [{ $eq: ['$feedback.falseAlarm', false] }, 1, 0] } },
          avgConfidence: { $avg: '$confidence' },
        },
      },
      {
        $project: {
          _id: 0,
          day: '$_id.day',
          parentId: '$_id.parentId',
          driverId: '$_id.driverId',
          type: '$_id.type',
          alerts: 1,
          detections: 1,
          acknowledged: 1,
          falseAlarms: 1,
          confirmed: 1,
          avgConfidence: { $round: ['$avgConfidence', 3] },
        },
      },
    ],
  },
  driver_daily_activity: {
    viewOn: 'sensor_minutes',
    pipeline: [
      {
        $group: {
          _id: { day: day('$minute'), driverId: '$driverId' },
          minutes: { $sum: 1 },
          readings: { $sum: '$readings' },
          drowsyMinutes: { $sum: { $cond: [{ $gt: ['$drowsy', 0] }, 1, 0] } },
          warningMinutes: {
            $sum: { $cond: [{ $and: [{ $eq: ['$drowsy', 0] }, { $gt: ['$warning', 0] }] }, 1, 0] },
          },
          ear: { $avg: '$ear' },
          perclos: { $avg: '$perclos' },
          heartRate: { $avg: '$heartRate' },
          maxScore: { $max: '$maxScore' },
        },
      },
      {
        $project: {
          _id: 0,
          day: '$_id.day',
          driverId: '$_id.driverId',
          minutes: 1,
          readings: 1,
          drowsyMinutes: 1,
          warningMinutes: 1,
          ear: { $round: ['$ear', 3] },
          perclos: { $round: ['$perclos', 3] },
          heartRate: { $round: ['$heartRate', 0] },
          maxScore: { $round: ['$maxScore', 3] },
        },
      },
    ],
  },
};

/** Create missing views and bring existing ones up to date with VIEWS. */
async function ensureViews(db = mongoose.connection.db) {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );
  for (const [name, { viewOn, pipeline }] of Object.entries(VIEWS)) {
    if (existing.has(name)) await db.command({ collMod: name, viewOn, pipeline });
    else await db.createCollection(name, { viewOn, pipeline });
  }
  logger.info({ views: Object.keys(VIEWS) }, 'database views ready');
}

module.exports = { ensureViews, VIEWS };
