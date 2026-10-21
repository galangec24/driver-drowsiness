/**
 * One-time e-mailed codes: proving a parent owns the e-mail they registered with (purpose
 * 'verify', stored in user.emailOtp) and resetting a forgotten password ('reset', user.resetOtp).
 *
 * - 6 digits from a CSPRNG, valid 10 minutes, stored only as a salted SHA-256 hash.
 * - 5 wrong attempts burn the code (a new one must be requested).
 * - A new code at most every 60 s and 5 per hour per account and purpose (protects the free
 *   e-mail quota; per-IP limits and a daily total sit on top, see rateLimit.middleware / mailer).
 */
const crypto = require('crypto');
const { sendMail } = require('./mailer');

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;

const FIELD = { verify: 'emailOtp', reset: 'resetOtp', delete: 'deleteOtp' };

const COPY = {
  verify: {
    subject: (code) => `${code} is your Guardian Drive code`,
    intro: 'use this code to verify your e-mail:',
    textIntro: 'Your Guardian Drive verification code is',
    footer: "If you didn't create a Guardian Drive account, you can ignore this e-mail.",
  },
  reset: {
    subject: (code) => `${code} is your Guardian Drive password reset code`,
    intro: 'use this code to reset your password:',
    textIntro: 'Your Guardian Drive password reset code is',
    footer:
      "If you didn't ask to reset your password, ignore this e-mail: your password stays the same.",
  },
  // Deleting a driver removes their photos, alerts and readings, so it needs the account e-mail.
  delete: {
    subject: (code) => `${code} confirms deleting a driver on Guardian Drive`,
    intro:
      'use this code to confirm deleting a driver and all of their alerts, photos and readings:',
    textIntro: 'To confirm deleting the driver, enter this code:',
    footer:
      "If you didn't ask to delete a driver, ignore this e-mail and change your password: nothing is deleted without this code.",
  },
};

// scope binds a code to one thing (e.g. the driver being deleted), so it can't be reused for another.
function hashCode(userId, code, scope = '') {
  const key = scope ? `${userId}:${scope}:${code}` : `${userId}:${code}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

function message(name, code, purpose = 'verify', detail = '') {
  const c = COPY[purpose];
  const extra = detail ? `\n${detail}\n` : '';
  const text = `Hi ${name},\n\n${c.textIntro} ${code}\n${extra}\nIt expires in 10 minutes. ${c.footer}\n`;
  const html = `<!doctype html><html><body style="margin:0;background:#05060f;font-family:Segoe UI,Roboto,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:460px;background:#0b0d1f;border:1px solid #23264a;border-radius:16px;padding:28px">
        <tr><td style="color:#ffffff;font-size:20px;font-weight:800">Guardian Drive</td></tr>
        <tr><td style="color:#9aa0c3;font-size:14px;padding-top:6px">Hi ${escapeHtml(name)}, ${c.intro}</td></tr>
        ${detail ? `<tr><td style="color:#ffffff;font-size:14px;font-weight:700;padding-top:10px">${escapeHtml(detail)}</td></tr>` : ''}
        <tr><td align="center" style="padding:22px 0">
          <div style="display:inline-block;background:#141735;border:1px solid #6366f1;border-radius:12px;padding:14px 22px;color:#ffffff;font-size:32px;font-weight:800;letter-spacing:10px">${code}</div>
        </td></tr>
        <tr><td style="color:#9aa0c3;font-size:13px">It expires in 10 minutes. ${escapeHtml(c.footer)}</td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
  return { subject: c.subject(code), text, html };
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/**
 * Send a new code unless the account is in its cooldown / hourly limit.
 * @returns {{sent:boolean, retryAfterS:number}}
 */
async function issueCode(
  user,
  now = Date.now(),
  purpose = 'verify',
  { scope = '', detail = '' } = {},
) {
  const field = FIELD[purpose];
  const otp = user[field] || {};
  const sentAt = otp.sentAt ? new Date(otp.sentAt).getTime() : 0;
  if (sentAt && now - sentAt < RESEND_COOLDOWN_MS) {
    return { sent: false, retryAfterS: Math.ceil((RESEND_COOLDOWN_MS - (now - sentAt)) / 1000) };
  }
  const windowStart = otp.windowStart ? new Date(otp.windowStart).getTime() : 0;
  const inWindow = windowStart && now - windowStart < 3600 * 1000;
  const sends = inWindow ? otp.sendsInWindow || 0 : 0;
  if (sends >= MAX_SENDS_PER_HOUR) {
    return { sent: false, retryAfterS: Math.ceil((windowStart + 3600 * 1000 - now) / 1000) };
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await sendMail({ to: user.email, ...message(user.name, code, purpose, detail) });
  user[field] = {
    hash: hashCode(user._id.toString(), code, scope),
    expiresAt: new Date(now + CODE_TTL_MS),
    attempts: 0,
    sentAt: new Date(now),
    windowStart: inWindow ? new Date(windowStart) : new Date(now),
    sendsInWindow: sends + 1,
  };
  await user.save();
  return { sent: true, retryAfterS: RESEND_COOLDOWN_MS / 1000 };
}

/**
 * Check a code. On success the code is consumed; for 'verify' the e-mail is also marked verified
 * and saved (for 'reset' the caller sets the new password and saves).
 * @returns {'ok'|'invalid'|'expired'|'too_many_attempts'|'no_code'}
 */
async function verifyCode(user, code, now = Date.now(), purpose = 'verify', scope = '') {
  const field = FIELD[purpose];
  const otp = user[field];
  if (!otp || !otp.hash) return 'no_code';
  if (otp.attempts >= MAX_ATTEMPTS) return 'too_many_attempts';
  if (new Date(otp.expiresAt).getTime() < now) return 'expired';
  const expected = Buffer.from(otp.hash, 'hex');
  const given = Buffer.from(hashCode(user._id.toString(), String(code), scope), 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    user[field].attempts = (otp.attempts || 0) + 1;
    user.markModified(field);
    await user.save();
    return user[field].attempts >= MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid';
  }
  user[field] = undefined;
  if (purpose === 'verify') user.emailVerified = true;
  if (purpose !== 'reset') await user.save();
  return 'ok';
}

module.exports = {
  issueCode,
  verifyCode,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  MAX_SENDS_PER_HOUR,
};
