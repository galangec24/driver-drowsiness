/**
 * Admin console > Parents > "Create parent account".
 *
 * The admin enters the parent's name and e-mail; the account gets a random temporary password,
 * e-mailed to that address (and shown once to the admin, to hand over in person if the e-mail is
 * slow). The parent can't use the account until they replace it with their own password
 * (POST /auth/change-temporary-password), which also proves the e-mail address is theirs.
 * TESTING PHASE: these accounts get the phone driver monitor (User.phoneMonitor).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const User = require('../models/User');
const HttpError = require('../utils/httpError');
const logger = require('../config/logger');
const { sendMail } = require('../services/mailer');

const createParentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d][\d\s-]*$/, 'Enter a phone number')
    .optional()
    .or(z.literal('')),
});

// No look-alike characters (0/O, 1/l/I): the password may be read out or typed from paper.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function temporaryPassword(length = 10) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const escapeHtml = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function welcomeEmail(name, email, password, appUrl) {
  const text = [
    `Hello ${name},`,
    '',
    'A Guardian Drive account was created for you.',
    `Sign in at ${appUrl} with:`,
    `  E-mail: ${email}`,
    `  Temporary password: ${password}`,
    '',
    'You will be asked to choose your own password the first time you sign in.',
    'If you were not expecting this e-mail, you can ignore it.',
  ].join('\n');
  const [n, e] = [escapeHtml(name), escapeHtml(email)];
  const html = `<p>Hello ${n},</p>
<p>A <b>Guardian Drive</b> account was created for you.</p>
<p>Sign in at <a href="${appUrl}">${appUrl}</a> with:<br>
E-mail: <b>${e}</b><br>
Temporary password: <b style="font-family:monospace;font-size:16px">${password}</b></p>
<p>You will be asked to choose your own password the first time you sign in.</p>
<p style="color:#666">If you were not expecting this e-mail, you can ignore it.</p>`;
  return { subject: 'Your Guardian Drive account', text, html };
}

/** POST /api/admin/parents {name, email, phone?} */
async function createParent(req, res) {
  const { name, email, phone } = req.body;
  if (await User.exists({ email }))
    throw new HttpError(409, 'An account with this email already exists');
  const password = temporaryPassword();
  const user = await User.create({
    name,
    email,
    ...(phone && { phone }),
    passwordHash: await bcrypt.hash(password, 10),
    role: 'parent',
    createdByAdmin: true,
    mustChangePassword: true,
  });
  const appUrl = (process.env.WEB_APP_URL || 'https://guardian-drive-ph.web.app').replace(
    /\/$/,
    '',
  );
  let emailSent = true;
  try {
    await sendMail({ to: email, ...welcomeEmail(name, email, password, appUrl) });
  } catch (err) {
    emailSent = false;
    logger.error({ err: err.message, email }, 'welcome e-mail failed');
  }
  res.status(201).json({ user: user.toPublic(), temporaryPassword: password, emailSent });
}

module.exports = { createParentSchema, createParent, temporaryPassword };
