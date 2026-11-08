const crypto = require('crypto');
const mongoose = require('mongoose');

/**
 * TESTING PHASE: a personal link that turns a phone's browser into the in-car driver monitor for
 * one driver (web/src/pages/monitor/). Like the in-car device's API key, but limited to that
 * driver, revocable and expiring. Only a hash of the secret is stored: the link itself is shown
 * once, when it is created. Remove with the web monitor (DRIVER_MONITOR_WEB).
 */
const monitorLinkSchema = new mongoose.Schema(
  {
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    lastUsedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

monitorLinkSchema.index({ driverId: 1, createdAt: -1 });

monitorLinkSchema.statics.hash = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

monitorLinkSchema.statics.newToken = () => crypto.randomBytes(18).toString('base64url');

monitorLinkSchema.methods.toPublic = function toPublic() {
  const now = Date.now();
  return {
    id: this._id.toString(),
    driverId: this.driverId.toString(),
    createdAt: this.createdAt,
    expiresAt: this.expiresAt,
    lastUsedAt: this.lastUsedAt || null,
    status: this.revokedAt ? 'revoked' : this.expiresAt.getTime() <= now ? 'expired' : 'active',
  };
};

module.exports = mongoose.model('MonitorLink', monitorLinkSchema);
