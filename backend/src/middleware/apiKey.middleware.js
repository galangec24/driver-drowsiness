const crypto = require('crypto');
const { env } = require('../config/env');
const HttpError = require('../utils/httpError');

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function requireApiKey(req, _res, next) {
  const key = req.headers['x-api-key'];
  if (typeof key !== 'string' || !env.ingestApiKey || !safeEqual(key, env.ingestApiKey)) {
    return next(new HttpError(401, 'Invalid API key'));
  }
  return next();
}

module.exports = { requireApiKey };
