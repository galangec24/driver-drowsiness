const mongoose = require('mongoose');
const { locationSchema } = require('./Driver');

const ALERT_TYPES = [
  'drowsy',
  'microsleep',
  'distraction',
  'face_match',
  'warning',
  'yawning',
  'nodding',
];

const verifierSchema = new mongoose.Schema(
  {
    score: Number,
    threshold: Number,
    modelVersion: Number,
    window: [mongoose.Schema.Types.Mixed],
  },
  { _id: false },
);

const alertSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ALERT_TYPES, required: true },
    confidence: { type: Number, min: 0, max: 1 },
    sensorSnapshot: {
      ear: Number,
      perclos: Number,
      heartRate: Number,
      hrv: Number,
      yawnCount: Number,
      nodCount: Number,
      distractionCount: Number,
      blinkRate: Number,
      longBlinkCount: Number,
      fuzzyScore: Number,
      closedForS: Number, // eyes closed this long (camera-confirmed microsleep)
      // Why the camera judged fatigue, e.g. "repeated yawning (3+ in 10 min)".
      fatigueReason: String,
      breathingRate: Number,
      timestamp: Date,
    },
    // Where the car was when the alert fired (absent if the device sends no GPS).
    location: { type: locationSchema, default: undefined },
    // First alert of a drive: how far / how long the driver had been driving since they were first
    // detected (services/tripTracker.js).
    trip: {
      type: new mongoose.Schema(
        {
          startedAt: Date,
          distanceKm: Number,
          minutes: Number,
          startLocation: { lat: Number, lng: Number },
        },
        { _id: false },
      ),
      default: undefined,
    },
    // Camera frame of the driver at the trigger moment, uploaded by the in-car device.
    snapshotUrl: { type: String },
    // Recorded while the device had no internet and delivered this many seconds later.
    delayedS: { type: Number },
    acknowledged: { type: Boolean, default: false },
    // Notification state for the parent (unread / read), separate from acknowledging.
    readAt: Date,
    // Repeated detections of the same kind are grouped into this alert (see ingestService).
    repeatCount: { type: Number, default: 1 },
    lastDetectedAt: Date,
    // Removed by the parent: hidden from every list (kept for the sensitivity tuner / ML labels).
    removedAt: Date,
    acknowledgedAt: Date,
    acknowledgedBy: { type: String, enum: ['apk', 'web', 'unknown'] },
    // Parent feedback — labels for retraining the false-positive verifier (ml/).
    feedback: {
      falseAlarm: Boolean,
      by: { type: String, enum: ['apk', 'web', 'unknown'] },
      at: Date,
    },
    // When the parent was notified about this alert (push / app notification). At most one alert
    // per driver per day notifies, except microsleeps (services/ingestService.js).
    notifiedAt: { type: Date },
    // Text message to the parent's phone (drowsy / microsleep only; services/smsAlerts.js).
    sms: {
      type: {
        status: { type: String, enum: ['sending', 'sent', 'failed', 'no_phone', 'limit'] },
        to: String, // masked, e.g. +63•••••4567
        at: Date,
        error: String,
      },
      default: undefined,
    },
    // Verifier evidence at alert time (server-side only; exported for retraining).
    verifier: { type: verifierSchema, select: false, default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

alertSchema.index({ driverId: 1, createdAt: -1 });
alertSchema.index({ parentId: 1, acknowledged: 1 });
alertSchema.index({ parentId: 1, removedAt: 1, createdAt: -1 });
alertSchema.index({ driverId: 1, acknowledged: 1, lastDetectedAt: -1 });

alertSchema.methods.toPublic = function toPublic(extra = {}) {
  // Lazy: alertDay → env; keeps the model importable on its own.
  const { isExpired } = require('../utils/alertDay');
  return {
    id: this._id.toString(),
    driverId: this.driverId.toString(),
    parentId: this.parentId.toString(),
    type: this.type,
    confidence: this.confidence,
    sensorSnapshot: this.sensorSnapshot,
    location: this.location || null,
    trip: this.trip || null,
    snapshotUrl: this.snapshotUrl || null,
    delayedS: this.delayedS || null,
    acknowledged: this.acknowledged,
    acknowledgedAt: this.acknowledgedAt,
    acknowledgedBy: this.acknowledgedBy,
    // Not acknowledged on the day it happened: can no longer be acknowledged, only removed.
    expired: isExpired(this),
    read: Boolean(this.readAt),
    repeatCount: this.repeatCount || 1,
    lastDetectedAt: this.lastDetectedAt || this.createdAt,
    readAt: this.readAt || null,
    falseAlarm: this.feedback ? (this.feedback.falseAlarm ?? null) : null,
    // "Texted to +63•••••4567" in the alert details.
    sms: this.sms && this.sms.status === 'sent' ? { to: this.sms.to, at: this.sms.at } : null,
    createdAt: this.createdAt,
    ...extra,
  };
};

module.exports = mongoose.model('Alert', alertSchema);
module.exports.ALERT_TYPES = ALERT_TYPES;
