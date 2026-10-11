const mongoose = require('mongoose');

/**
 * Sign-in handed from a browser to an app. The Windows/Android app opens the website's
 * /app-login page in the user's normal browser (Google refuses to sign in inside embedded app
 * browsers); after "Continue with Google" there, the server parks the session here under a hash of
 * the app's random handoff id, and the app collects it once. Expires after a few minutes.
 */
const authHandoffSchema = new mongoose.Schema(
  {
    _id: { type: String }, // sha256(handoff id), so a database read can't reuse the id
    token: { type: String, required: true },
    user: { type: mongoose.Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

authHandoffSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthHandoff', authHandoffSchema);
