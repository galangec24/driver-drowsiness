/**
 * Outgoing text messages (SMS). Providers (SMS_PROVIDER):
 *   semaphore  Semaphore (semaphore.co), a Philippine SMS gateway: ~PHP 0.50 per 160 characters,
 *              pay as you go. Needs SEMAPHORE_API_KEY; SEMAPHORE_SENDER is an approved sender name
 *              (optional, the default is "SEMAPHORE").
 *   twilio     Twilio (worldwide). Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM.
 *   console    development: the text is written to the server log instead of being sent.
 *   (unset)    no texts.
 */
const { env } = require('../config/env');
const logger = require('../config/logger');

let sendImpl = null; // test hook
const daily = { day: '', count: 0 };

/**
 * A phone number as typed in the profile → E.164 (+639171234567), or null if it can't be a
 * mobile number. Numbers without a country code are taken as Philippine (09171234567).
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return null;
}

/** +639171234567 → +63•••••4567 (for logs and the alert details). */
function maskPhone(e164) {
  return e164 ? `${e164.slice(0, 3)}•••••${e164.slice(-4)}` : '';
}

async function sendSemaphore(to, text) {
  const body = new URLSearchParams({
    apikey: env.sms.semaphoreApiKey,
    number: to.replace(/^\+/, ''),
    message: text,
    ...(env.sms.semaphoreSender && { sendername: env.sms.semaphoreSender }),
  });
  const res = await fetch('https://api.semaphore.co/api/v4/messages', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const out = await res.text().catch(() => '');
  // Semaphore answers 200 with an error object for some problems (e.g. no credits).
  if (!res.ok || /"error|"status":\s*"failed/i.test(out)) {
    throw new Error(`Semaphore ${res.status}: ${out.slice(0, 200)}`);
  }
}

async function sendTwilio(to, text) {
  const { twilioSid: sid, twilioToken: token, twilioFrom: from } = env.sms;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
    body: new URLSearchParams({ To: to, From: from, Body: text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const out = await res.text().catch(() => '');
    throw new Error(`Twilio ${res.status}: ${out.slice(0, 200)}`);
  }
}

/** True when texts can actually be sent (a provider is configured, or a test hook). */
function canSendSms() {
  const p = env.sms.provider;
  return (
    Boolean(sendImpl) ||
    p === 'console' ||
    (p === 'semaphore' && Boolean(env.sms.semaphoreApiKey)) ||
    (p === 'twilio' && Boolean(env.sms.twilioSid && env.sms.twilioToken && env.sms.twilioFrom))
  );
}

/** @param {string} to E.164 number  @param {string} text */
async function sendSms(to, text) {
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) Object.assign(daily, { day: today, count: 0 });
  if (daily.count >= env.sms.dailyLimit) {
    throw new Error(`Daily SMS limit reached (${env.sms.dailyLimit})`);
  }
  daily.count += 1;
  if (sendImpl) return sendImpl(to, text);
  if (env.sms.provider === 'semaphore') return sendSemaphore(to, text);
  if (env.sms.provider === 'twilio') return sendTwilio(to, text);
  if (env.sms.provider === 'console') {
    logger.info({ to: maskPhone(to) }, `SMS (console mode): ${text}`);
    return undefined;
  }
  throw new Error('No SMS provider configured (SMS_PROVIDER)');
}

function _setSendImpl(fn) {
  sendImpl = fn;
  Object.assign(daily, { day: '', count: 0 });
}

module.exports = { sendSms, canSendSms, normalizePhone, maskPhone, _setSendImpl };
