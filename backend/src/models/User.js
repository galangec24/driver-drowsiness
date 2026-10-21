const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Absent for accounts created with "Continue with Google" (they can add one via Forgot password).
    passwordHash: { type: String, select: false },
    // Google account id ("sub") once the user has signed in with Google.
    googleId: { type: String, index: { unique: true, sparse: true }, select: false },
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
    // Forgot-password code (same shape and limits as emailOtp).
    resetOtp: {
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
    // Code e-mailed to confirm deleting a driver (same shape and limits as emailOtp).
    deleteOtp: {
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
