const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const HttpError = require('../utils/httpError');

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

/** Returns { parentId, role } or throws. */
function verifyToken(token) {
  const payload = jwt.verify(token, env.jwtSecret);
  return { parentId: payload.sub, role: payload.role };
}

function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Missing bearer token'));
  }
  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return next(new HttpError(401, 'Invalid or expired token'));
  }
}

module.exports = { requireAuth, signToken, verifyToken };
