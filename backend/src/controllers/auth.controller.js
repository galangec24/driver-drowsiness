const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { env } = require('../config/env');
const User = require('../models/User');
const HttpError = require('../utils/httpError');
const { signToken } = require('../middleware/auth.middleware');
const emailOtp = require('../services/emailOtp');
const { verifyGoogleIdToken } = require('../services/googleAuth');
const AuthHandoff = require('../models/AuthHandoff');
const logger = require('../config/logger');

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

const verifySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

const resendSchema = z.object({ email: z.string().trim().toLowerCase().email() });

const forgotSchema = resendSchema;

const resetSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
  password: z.string().min(8).max(128),
});

// `handoff`: random id from the Windows/Android app that opened this sign-in in the browser.
const handoffId = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'invalid handoff id');
const googleSchema = z.object({
  credential: z.string().min(20).max(8192),
  handoff: handoffId.optional(),
});

const HANDOFF_TTL_MS = 5 * 60 * 1000;
const handoffKey = (id) => crypto.createHash('sha256').update(id).digest('hex');

const fcmTokenSchema = z.object({
  fcmToken: z.string().min(1).max(4096),
});

/** Accounts listed in ADMIN_EMAILS get the admin role (training console) when they sign in. */
async function applyAdminRole(user) {
  if (env.adminEmails.includes(user.email) && user.role !== 'admin') {
    user.role = 'admin';
    await user.save();
  }
  return user;
}

async function register(req, res) {
  const { name, email, password } = req.body;
  const verify = env.emailVerification;
  const existing = await User.findOne({ email }).select('+emailOtp');
  // An account whose e-mail was never verified was never usable (nobody could sign in to it), so
  // registering again simply takes it over: new name/password and a fresh code. Otherwise a failed
  // or lost code e-mail would lock that address out for good.
  if (existing && !(verify && existing.emailVerified === false)) {
    throw new HttpError(409, 'An account with this email already exists');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  let user;
  if (existing) {
    existing.name = name;
    existing.passwordHash = passwordHash;
    await existing.save();
    user = existing;
  } else {
    user = await applyAdminRole(
      await User.create({ name, email, passwordHash, ...(verify && { emailVerified: false }) }),
    );
  }
  if (!verify) {
    res.status(201).json({ token: signToken(user), user: user.toPublic() });
    return;
  }
  const sent = await sendCodeSafely(user);
  // No token yet: the account is usable only after the e-mailed code is entered.
  res.status(201).json({
    verificationRequired: true,
    email,
    retryAfterS: sent.retryAfterS,
    emailSent: !sent.failed,
  });
}

async function login(req, res) {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  if (user && !user.passwordHash) {
    // Created with "Continue with Google" and never given a password.
    throw new HttpError(
      401,
      'This account uses Google sign-in. Tap "Continue with Google", or use "Forgot password?" to set a password.',
      { code: 'GOOGLE_ACCOUNT' },
    );
  }
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) throw new HttpError(401, 'Invalid email or password');
  if (env.emailVerification && user.emailVerified === false) {
    // Password was right: send a fresh code (cooldown permitting) and ask for it.
    const withOtp = await User.findById(user._id).select('+emailOtp');
    const sent = await sendCodeSafely(withOtp);
    throw new HttpError(403, 'Verify your e-mail first: we sent a 6-digit code to ' + email, {
      code: 'EMAIL_NOT_VERIFIED',
      email,
      retryAfterS: sent.retryAfterS,
      emailSent: !sent.failed,
    });
  }
  await applyAdminRole(user);
  res.json({ token: signToken(user), user: user.toPublic() });
}

/** Send a code; an e-mail outage must not lose the registration (the user can press "Resend"). */
async function sendCodeSafely(user, purpose = 'verify') {
  try {
    return await emailOtp.issueCode(user, Date.now(), purpose);
  } catch (err) {
    logger.error({ err: err.message, email: user.email }, 'verification e-mail failed');
    return { sent: false, failed: true, retryAfterS: 0, reason: err.message };
  }
}

const VERIFY_ERRORS = {
  invalid: [400, 'That code is not correct. Check the e-mail and try again.'],
  expired: [400, 'That code has expired. Tap "Resend code" for a new one.'],
  too_many_attempts: [429, 'Too many wrong codes. Tap "Resend code" for a new one.'],
  no_code: [400, 'No active code. Tap "Resend code".'],
};

/** POST /auth/verify-email {email, code} → signs the user in once the code matches. */
async function verifyEmail(req, res) {
  const { email, code } = req.body;
  const user = await User.findOne({ email }).select('+emailOtp');
  if (!user) throw new HttpError(400, VERIFY_ERRORS.invalid[1]);
  if (user.emailVerified !== false) {
    throw new HttpError(409, 'This e-mail is already verified. Sign in with your password.');
  }
  const result = await emailOtp.verifyCode(user, code);
  if (result !== 'ok') {
    const [status, message] = VERIFY_ERRORS[result];
    throw new HttpError(status, message, { code: result });
  }
  await applyAdminRole(user);
  res.json({ token: signToken(user), user: user.toPublic() });
}

/** POST /auth/resend-code {email} — same answer whether or not the account exists (no enumeration). */
async function resendCode(req, res) {
  const user = await User.findOne({ email: req.body.email }).select('+emailOtp');
  let retryAfterS = 60;
  if (user && user.emailVerified === false) {
    const sent = await sendCodeSafely(user);
    if (sent.failed) {
      const err = new HttpError(
        503,
        "We couldn't send the e-mail right now. Please try again in a few minutes.",
      );
      err.reason = sent.reason; // logged by the error handler, never sent to the client
      throw err;
    }
    retryAfterS = sent.retryAfterS || retryAfterS;
  }
  res.json({ ok: true, retryAfterS });
}

/** POST /auth/forgot-password {email}: e-mail a reset code. Same answer whether or not the account exists. */
async function forgotPassword(req, res) {
  const user = await User.findOne({ email: req.body.email }).select('+resetOtp');
  let retryAfterS = 60;
  if (user) {
    const sent = await sendCodeSafely(user, 'reset');
    if (sent.failed) {
      const err = new HttpError(
        503,
        "We couldn't send the e-mail right now. Please try again in a few minutes.",
      );
      err.reason = sent.reason;
      throw err;
    }
    retryAfterS = sent.retryAfterS || retryAfterS;
  }
  res.json({ ok: true, retryAfterS });
}

/** POST /auth/reset-password {email, code, password}: set a new password and sign in. */
async function resetPassword(req, res) {
  const { email, code, password } = req.body;
  const user = await User.findOne({ email }).select('+resetOtp +emailOtp');
  if (!user) throw new HttpError(400, VERIFY_ERRORS.invalid[1], { code: 'invalid' });
  const result = await emailOtp.verifyCode(user, code, Date.now(), 'reset');
  if (result !== 'ok') {
    const [status, message] = VERIFY_ERRORS[result];
    throw new HttpError(status, message, { code: result });
  }
  user.passwordHash = await bcrypt.hash(password, 10);
  // The code arrived by e-mail, so the address is proven too.
  if (user.emailVerified === false) {
    user.emailVerified = true;
    user.emailOtp = undefined;
  }
  await user.save();
  await applyAdminRole(user);
  res.json({ token: signToken(user), user: user.toPublic() });
}

/** GET /auth/config: public sign-in options for the clients (no secrets). */
function config(_req, res) {
  res.json({
    googleClientId: env.googleClientIds[0] || null,
    emailVerification: env.emailVerification,
  });
}

/** POST /auth/google {credential}: sign in (or sign up) with a Google ID token. */
async function google(req, res) {
  if (!env.googleClientIds.length)
    throw new HttpError(503, 'Google sign-in is not set up on this server');
  let g;
  try {
    g = await verifyGoogleIdToken(req.body.credential);
  } catch (err) {
    logger.warn({ err: err.message }, 'google token rejected');
    throw new HttpError(401, 'Google sign-in failed. Please try again.');
  }
  if (!g.sub || !g.email || !g.emailVerified) {
    throw new HttpError(401, 'Your Google account has no verified e-mail address.');
  }

  let user = await User.findOne({ googleId: g.sub }).select('+googleId');
  if (!user) {
    user = await User.findOne({ email: g.email }).select('+googleId +passwordHash +emailOtp');
    if (user) {
      user.googleId = g.sub;
      if (user.emailVerified === false) {
        // Never verified: whoever registered it could not prove the address, and Google just did.
        // Drop that password so only the real owner (via Google or Forgot password) gets in.
        user.passwordHash = undefined;
        user.emailVerified = true;
        user.emailOtp = undefined;
      }
      await user.save();
    } else {
      user = await User.create({
        name: g.name.slice(0, 80),
        email: g.email,
        googleId: g.sub,
        emailVerified: true,
      });
    }
  }
  await applyAdminRole(user);
  const token = signToken(user);
  if (req.body.handoff) {
    // Park the session for the app that is waiting for it (collected once by GET /auth/handoff/:id).
    await AuthHandoff.findOneAndUpdate(
      { _id: handoffKey(req.body.handoff) },
      { token, user: user.toPublic(), expiresAt: new Date(Date.now() + HANDOFF_TTL_MS) },
      { upsert: true },
    );
  }
  res.json({ token, user: user.toPublic() });
}

/**
 * GET /auth/handoff/:id: the app polls this while the user signs in in the browser.
 * {pending: true} until then; the session is handed out exactly once.
 */
async function collectHandoff(req, res) {
  const parsed = handoffId.safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(400, 'invalid handoff id');
  const doc = await AuthHandoff.findOneAndDelete({ _id: handoffKey(parsed.data) });
  if (!doc || doc.expiresAt.getTime() < Date.now()) {
    res.json({ pending: true });
    return;
  }
  res.json({ token: doc.token, user: doc.user });
}

async function me(req, res) {
  const user = await User.findById(req.user.parentId);
  if (!user) throw new HttpError(404, 'User not found');
  res.json({ user: user.toPublic() });
}

async function setFcmToken(req, res) {
  await User.updateOne({ _id: req.user.parentId }, { fcmToken: req.body.fcmToken });
  res.json({ ok: true });
}

module.exports = {
  register,
  login,
  me,
  setFcmToken,
  verifyEmail,
  resendCode,
  forgotPassword,
  resetPassword,
  config,
  google,
  collectHandoff,
  registerSchema,
  loginSchema,
  fcmTokenSchema,
  verifySchema,
  resendSchema,
  forgotSchema,
  resetSchema,
  googleSchema,
};
