const mongoose = require('mongoose');

/** One optional app rating per account (1-5 stars + an optional comment); it can be changed or removed. */
const ratingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    stars: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 500, default: '' },
    platform: { type: String, enum: ['web', 'android', 'windows', 'unknown'], default: 'unknown' },
    appVersion: String,
  },
  { timestamps: true },
);

ratingSchema.index({ updatedAt: -1 });

/** "Ana Cruz" -> "Ana C." : reviews are shown to every user, so full names stay private. */
function shortName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'A user';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

ratingSchema.methods.toPublic = function toPublic(userName) {
  return {
    id: this._id.toString(),
    stars: this.stars,
    comment: this.comment || '',
    platform: this.platform,
    author: shortName(userName),
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Rating', ratingSchema);
module.exports.shortName = shortName;
