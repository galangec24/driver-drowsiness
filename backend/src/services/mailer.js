/**
 * Outgoing e-mail. Providers:
 *   brevo    Brevo transactional e-mail over HTTPS (free: 300/day). Works on Render's free plan,
 *            which blocks SMTP ports 25/465/587. Needs BREVO_API_KEY and a verified EMAIL_FROM.
 *   console  development: the message is written to the server log instead of being sent.
 *   (unset)  no e-mail; e-mail verification is then off (see env.emailVerification).
 */
const { env } = require('../config/env');
const logger = require('../config/logger');

let sendImpl = null; // test hook
// E-mails sent today (UTC); protects the provider's free daily quota from abuse.
const daily = { day: '', count: 0 };

async function sendBrevo({ to, subject, html, text }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.email.brevoApiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: env.email.fromName, email: env.email.from },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** @param {{to:string, subject:string, html:string, text:string}} msg */
async function sendMail(msg) {
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) Object.assign(daily, { day: today, count: 0 });
  if (daily.count >= env.emailDailyLimit) {
    throw new Error(`Daily e-mail limit reached (${env.emailDailyLimit})`);
  }
  daily.count += 1;
  if (sendImpl) return sendImpl(msg);
  if (env.email.provider === 'brevo') return sendBrevo(msg);
  if (env.email.provider === 'console') {
    logger.info({ to: msg.to, subject: msg.subject }, `EMAIL (console mode)\n${msg.text}`);
    return undefined;
  }
  throw new Error('No e-mail provider configured (EMAIL_PROVIDER)');
}

function _setSendImpl(fn) {
  sendImpl = fn;
  Object.assign(daily, { day: '', count: 0 });
}

module.exports = { sendMail, _setSendImpl };
