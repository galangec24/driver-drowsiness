const mongoose = require('mongoose');

const thresholdsSchema = new mongoose.Schema(
  {
    earThreshold: { type: Number, default: 0.21 },
    perclosThreshold: { type: Number, default: 0.4 },
    drowsyDurationMs: { type: Number, default: 2000 },
    fusionWeightVision: { type: Number, default: 0.6 },
    fusionWeightPhysio: { type: Number, default: 0.4 },
    // Wearable + yawning (docs/WEARABLE.md § Fusion)
    yawnThreshold: { type: Number, default: 3 },
    fusionWeightYawn: { type: Number, default: 0.2 },
    hrDropThreshold: { type: Number, default: 0.15 },
    breathDropThreshold: { type: Number, default: 0.2 },
    nodThreshold: { type: Number, default: 2 },
    fusionWeightNod: { type: Number, default: 0.3 },
  },
  { _id: false },
);

const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    heading: Number, // degrees clockwise from north (GPS course)
    speed: Number, // km/h
    accuracy: Number, // metres
    at: Date,
  },
  { _id: false },
);

/**
 * Comparison key for driver names: Unicode-normalised, case- and whitespace-insensitive.
 * "Juan  Dela Cruz" and "juan dela cruz" collide; "Juan Dela Cruz Jr." does not.
 */
function nameKeyOf(name) {
  return String(name || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');
}

const driverSchema = new mongoose.Schema(
  {
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    // nameKeyOf(name) — unique per parent so two drivers (e.g. twins) can't share a name.
    nameKey: { type: String },
    relationship: { type: String, default: '', trim: true },
    // 128-d face descriptor. Never sent to the client.
    faceEmbedding: { type: [Number], default: undefined, select: false },
    referencePhotoUrl: { type: String, default: '' },
    personalThresholds: { type: thresholdsSchema, default: () => ({}) },
    // Additive metadata about enrollment and adaptive tuning (never secret).
    enrollment: {
      photoCount: { type: Number, default: 0 },
      quality: { type: Number, default: 0 },
      enrolledAt: Date,
    },
    lastTunedAt: Date,
    // What automatic tuning learned (shown to the parent instead of editable thresholds).
    tuning: {
      mode: { type: String, enum: ['learning', 'standard', 'reduced'] },
      eyeSamples: Number,
      eyeBaseline: Number,
      falseAlarms: Number,
      realAlarms: Number,
      falseAlarmRate: Number,
      updatedAt: Date,
    },
    // Last GPS fix reported by the in-car device (persisted at most every few seconds).
    lastLocation: { type: locationSchema, default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

driverSchema.index({ parentId: 1 });
driverSchema.index(
  { parentId: 1, nameKey: 1 },
  { unique: true, partialFilterExpression: { nameKey: { $type: 'string' } } },
);

driverSchema.pre('validate', function setNameKey(next) {
  if (this.isModified('name') || !this.nameKey) this.nameKey = nameKeyOf(this.name);
  next();
});

driverSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    parentId: this.parentId.toString(),
    name: this.name,
    relationship: this.relationship,
    referencePhotoUrl: this.referencePhotoUrl,
    personalThresholds: this.personalThresholds.toObject
      ? this.personalThresholds.toObject()
      : this.personalThresholds,
    faceEnrolled: (this.enrollment && this.enrollment.photoCount > 0) || false,
    enrollment: this.enrollment,
    lastTunedAt: this.lastTunedAt,
    tuning: this.tuning && this.tuning.mode ? this.tuning : { mode: 'learning' },
    lastLocation: this.lastLocation || null,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Driver', driverSchema);
module.exports.nameKeyOf = nameKeyOf;
module.exports.locationSchema = locationSchema;
