/**
 * Small in-memory fixed-window rate limiter (one Render instance, so no shared store is needed;
 * counters reset when the server restarts). Used on sign-in and e-mail-code endpoints to stop
 * password guessing and code spam on top of the per-account limits in services/emailOtp.js.
 */
const { env } = require('../config/env');
const HttpError = require('../utils/httpError');

const buckets = new Map(); // key -> { count, resetAt }
let sweepAt = 0;

function hit(key, windowMs, now) {
  if (now > sweepAt) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    sweepAt = now + 60_000;
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return b;
}

/**
 * @param {object} opts
 * @param {string} opts.name      bucket namespace
 * @param {number} opts.windowMs
 * @param {number} opts.max       requests allowed per window and key
 * @param {(req) => string} [opts.key]  default: client IP
 * @param {string} opts.message
 */
function rateLimit({ name, windowMs, max, key = (req) => req.ip, message }) {
  return (req, res, next) => {
    if (!env.rateLimit) return next();
    const now = Date.now();
    const b = hit(`${name}:${key(req)}`, windowMs, now);
    if (b.count <= max) return next();
    const retryAfterS = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    res.set('Retry-After', String(retryAfterS));
    return next(new HttpError(429, message, { code: 'RATE_LIMITED', retryAfterS }));
  };
}

const emailOf = (req) =>
  String(req.body?.email || '')
    .trim()
    .toLowerCase();

/** Endpoints that send an e-mail (register, resend code, forgot password). */
const codeEmailLimit = [
  rateLimit({
    name: 'code-ip',
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many code requests from this network. Try again later.',
  }),
  rateLimit({
    name: 'code-email',
    windowMs: 24 * 60 * 60 * 1000,
    max: 10,
    key: emailOf,
    message: 'Too many codes requested for this e-mail today. Try again tomorrow.',
  }),
];

/** Password / code guessing (login, verify-email, reset-password). */
const signInLimit = [
  rateLimit({
    name: 'signin-ip',
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many sign-in attempts. Wait 15 minutes and try again.',
  }),
  rateLimit({
    name: 'signin-email',
    windowMs: 15 * 60 * 1000,
    max: 10,
    key: (req) => `${req.ip}|${emailOf(req)}`,
    message: 'Too many attempts for this account. Wait 15 minutes and try again.',
  }),
];

const googleLimit = rateLimit({
  name: 'google-ip',
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many sign-in attempts. Wait 15 minutes and try again.',
});

/** App polling for a browser sign-in (one poll every ~2 s for at most 5 minutes). */
const handoffLimit = rateLimit({
  name: 'handoff-ip',
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: 'Too many sign-in checks. Wait a few minutes and try again.',
});

function _reset() {
  buckets.clear();
}

module.exports = { rateLimit, codeEmailLimit, signInLimit, googleLimit, handoffLimit, _reset };
