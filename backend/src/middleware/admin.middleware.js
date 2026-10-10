const User = require('../models/User');
const HttpError = require('../utils/httpError');

/**
 * After requireAuth: the account must currently be an admin. The role is re-read from the database
 * (not trusted from the JWT), so removing someone's admin role takes effect immediately.
 */
async function requireAdmin(req, _res, next) {
  const user = await User.findById(req.user.parentId).select('role').lean();
  if (!user || user.role !== 'admin') throw new HttpError(403, 'Admin access required');
  req.user.role = 'admin';
  next();
}

async function isAdmin(userId) {
  const user = await User.findById(userId).select('role').lean();
  return Boolean(user && user.role === 'admin');
}

module.exports = { requireAdmin, isAdmin };
