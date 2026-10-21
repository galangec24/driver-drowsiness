const mongoose = require('mongoose');

/**
 * A short message or reminder from a parent to the car. The in-car voice reads it to the driver
 * ("Message from Maria. Please take a break."); the device confirms, so the parent sees "Delivered".
 * Messages to a car that is offline wait (pending) and are delivered when it reconnects, unless
 * they are older than PENDING_TTL_MS by then.
 */
const messageSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fromName: { type: String, default: '' },
    text: { type: String, required: true, maxlength: 200 },
    kind: { type: String, enum: ['message', 'reminder'], default: 'message' },
    // The language it is written in, so the car picks that voice ('auto' = the car detects it).
    lang: { type: String, default: 'auto' },
    status: { type: String, enum: ['pending', 'delivered', 'expired'], default: 'pending' },
    deliveredAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ driverId: 1, createdAt: -1 });
messageSchema.index({ driverId: 1, status: 1 });

messageSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    driverId: this.driverId.toString(),
    fromName: this.fromName,
    text: this.text,
    kind: this.kind,
    lang: this.lang || 'auto',
    status: this.status,
    deliveredAt: this.deliveredAt || null,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Message', messageSchema);
module.exports.PENDING_TTL_MS = 2 * 60 * 60 * 1000;
