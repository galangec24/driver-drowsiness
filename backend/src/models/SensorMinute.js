const mongoose = require('mongoose');
const { locationSchema } = require('./Driver');

/**
 * One row per driver per minute of readings: a materialized view of SensorLog, written by
 * services/sensorRollup.js with $merge. The history screen reads these instead of grouping up to
 * ~600,000 raw readings (7 days at 1 Hz) on every request.
 */
const sensorMinuteSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true },
    minute: { type: Date, required: true }, // start of the minute (UTC)
    firstAt: Date,
    lastAt: Date,
    readings: Number,
    ear: Number, // averages over the minute
    perclos: Number,
    heartRate: Number,
    maxScore: Number,
    drowsy: Number, // readings classified drowsy / warning
    warning: Number,
    location: { type: locationSchema, default: undefined }, // last fix in the minute
    source: String,
  },
  { collection: 'sensor_minutes', versionKey: false },
);

// $merge matches on these fields, so they need a unique index; it also serves history ranges.
sensorMinuteSchema.index({ driverId: 1, minute: 1 }, { unique: true });

/** How far SensorLog has been rolled up (one document, _id = 'sensor_minutes'). */
const rollupStateSchema = new mongoose.Schema(
  { _id: String, until: Date, runAt: Date, lastMs: Number },
  { collection: 'rollup_state', versionKey: false },
);

module.exports = mongoose.model('SensorMinute', sensorMinuteSchema);
module.exports.RollupState = mongoose.model('RollupState', rollupStateSchema);
