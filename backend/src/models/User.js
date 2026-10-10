const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, default: 'parent' },
    // false = registered but the e-mail code was not entered yet. Accounts created before e-mail
    // verification existed have no value and count as verified.
    emailVerified: { type: Boolean },
    emailOtp: {
      type: {
        hash: String,
        expiresAt: Date,
        attempts: Number,
        sentAt: Date,
        windowStart: Date,
        sendsInWindow: Number,
      },
      select: false,
      default: undefined,
    },
    fcmToken: { type: String, select: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    emailVerified: this.emailVerified !== false,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
