const mongoose = require('mongoose');
const { locationSchema } = require('./Driver');

// web_monitor: the phone-browser driver monitor (testing phase, monitor links).
const SOURCES = ['simulated', 'driver_monitor', 'mobile_app', 'hardware', 'web_monitor'];

const sensorLogSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true },
    signals: {
      ear: Number,
      perclos: Number,
      heartRate: Number,
      faceConfidence: Number,
      // Optional, from the BLE wearable / yawn detector (docs/WEARABLE.md)
      hrv: Number,
      hrBaseline: Number,
      yawnCount: Number,
      nodCount: Number,
      distractionCount: Number,
      blinkRate: Number,
      longBlinkCount: Number,
      fuzzyScore: Number,
      closedForS: Number,
      fatigueReason: String,
      mar: Number,
      breathingRate: Number,
      breathingBaseline: Number,
    },
    classification: { type: String, enum: ['alert', 'warning', 'drowsy'], required: true },
    fusionScore: { type: Number, required: true },
    source: { type: String, enum: SOURCES, required: true },
    // Verifier probability for candidate ticks (absent when it abstained / was disabled).
    verifierScore: Number,
    location: { type: locationSchema, default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

sensorLogSchema.index({ driverId: 1, createdAt: -1 });
// Time ranges across all drivers: the per-minute rollup (services/sensorRollup.js).
sensorLogSchema.index({ createdAt: 1 });

module.exports = mongoose.model('SensorLog', sensorLogSchema);
module.exports.SOURCES = SOURCES;
