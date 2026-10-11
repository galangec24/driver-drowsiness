const mongoose = require('mongoose');

/**
 * Heartbeat of a training worker running on another machine (`npm run worker` on a laptop with
 * the ml/ Python environment). The API server (e.g. Render, no Python) reads it to know that
 * queued jobs will be picked up, and shows the worker's local datasets in the admin console.
 */
const workerStatusSchema = new mongoose.Schema(
  {
    _id: { type: String }, // worker id (hostname by default)
    host: String,
    info: { type: mongoose.Schema.Types.Mixed, default: {} },
    datasets: { type: mongoose.Schema.Types.Mixed, default: null },
    busy: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

module.exports = mongoose.model('WorkerStatus', workerStatusSchema);
