const mongoose = require('mongoose');

const JOB_TYPES = [
  'fetch_dataset', // Kaggle eye dataset → ml/data/eyes_<id>
  'train_verifier', // false-alarm verifier (synthetic + feedback + recordings) → candidate release
  'train_eye_state', // eye open/closed image model → candidate release
  'calibrate_yawn', // yawn mouth threshold from a yawn image dataset → candidate release
  'process_videos', // video dataset folder → labelled recordings → ml/data/recordings_<name>
  'import_uploads', // uploaded .jsonl recordings → ml/data/recordings_uploads
];
const JOB_STATUS = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

const trainingJobSchema = new mongoose.Schema(
  {
    type: { type: String, enum: JOB_TYPES, required: true },
    params: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: JOB_STATUS, default: 'queued' },
    // Tail of stdout/stderr (capped) — the full run is reproducible from params.
    log: { type: String, default: '' },
    error: String,
    releaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'ModelRelease' },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Which worker claimed it, and a cancel request for a job running on another machine.
    worker: String,
    cancelRequested: { type: Boolean, default: false },
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

trainingJobSchema.index({ createdAt: -1 });

trainingJobSchema.methods.toPublic = function toPublic({ withLog = false } = {}) {
  return {
    id: this._id.toString(),
    type: this.type,
    params: this.params,
    status: this.status,
    error: this.error || null,
    releaseId: this.releaseId ? this.releaseId.toString() : null,
    createdAt: this.createdAt,
    startedAt: this.startedAt || null,
    finishedAt: this.finishedAt || null,
    worker: this.worker || null,
    ...(withLog && { log: this.log }),
  };
};

module.exports = mongoose.model('TrainingJob', trainingJobSchema);
module.exports.JOB_TYPES = JOB_TYPES;
