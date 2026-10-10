const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { env } = require('../config/env');
const User = require('../models/User');
const HttpError = require('../utils/httpError');
const { signToken } = require('../middleware/auth.middleware');

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

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
  if (await User.exists({ email })) {
    throw new HttpError(409, 'An account with this email already exists');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await applyAdminRole(await User.create({ name, email, passwordHash }));
  res.status(201).json({ token: signToken(user), user: user.toPublic() });
}

async function login(req, res) {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) throw new HttpError(401, 'Invalid email or password');
  await applyAdminRole(user);
  res.json({ token: signToken(user), user: user.toPublic() });
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

module.exports = { register, login, me, setFcmToken, registerSchema, loginSchema, fcmTokenSchema };
