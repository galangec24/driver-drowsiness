const mongoose = require('mongoose');

/**
 * A trained model (or calibrated setting) produced by an admin training job.
 * Stored in MongoDB, not on disk, so promotions survive redeploys (e.g. Render's ephemeral disk).
 *
 * kind:
 *   fp_verifier     backend false-alarm verifier (gradient-boosted trees JSON)
 *   eye_state       driver_monitor eye open/closed model (served to in-car devices)
 *   yawn_threshold  { yawnMar } for the in-car yawn detector
 * Exactly one release per kind can be `active`; none active = the version bundled with the code.
 */
const KINDS = ['fp_verifier', 'eye_state', 'yawn_threshold'];

const modelReleaseSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: KINDS, required: true },
    status: { type: String, enum: ['candidate', 'active', 'retired'], default: 'candidate' },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'TrainingJob' },
    // Headline numbers for the admin table; full metrics in `metrics`.
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    metrics: { type: mongoose.Schema.Types.Mixed, select: false },
    report: { type: String, select: false },
    artifact: { type: mongoose.Schema.Types.Mixed, select: false },
    promotedAt: Date,
    promotedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

modelReleaseSchema.index({ kind: 1, status: 1 });

modelReleaseSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    kind: this.kind,
    status: this.status,
    jobId: this.jobId ? this.jobId.toString() : null,
    summary: this.summary,
    createdAt: this.createdAt,
    promotedAt: this.promotedAt || null,
    ...(this.report !== undefined && { report: this.report }),
  };
};

module.exports = mongoose.model('ModelRelease', modelReleaseSchema);
module.exports.KINDS = KINDS;
