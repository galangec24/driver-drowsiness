/**
 * Text the parent when a driver is drowsy. Push notifications and the live dashboard need the app
 * and mobile data; a text reaches the parent's phone even when they are offline or the app is
 * closed. Rules:
 *   - only drowsy and microsleep alerts (the dangerous ones), when the alert is created or when an
 *     open warning escalates to drowsy; never again for "detected again" of the same alert;
 *   - only to the number in the parent's profile (Settings → Profile), in their language;
 *   - at most SMS_PER_PARENT_DAILY texts per parent per day (and SMS_DAILY_LIMIT in total);
 *   - readings that arrive more than 10 minutes late (offline car) are not texted.
 * Runs after the alert is saved and never delays the reading (callers don't await it).
 */
const { env } = require('../config/env');
const logger = require('../config/logger');
const Alert = require('../models/Alert');
const User = require('../models/User');
const sms = require('./sms');

const TEXT_TYPES = new Set(['drowsy', 'microsleep']);
const STALE_S = 10 * 60;
const perParent = new Map(); // `${parentId}:${day}` → texts sent

const TEMPLATES = {
  en: {
    drowsy: 'Guardian Drive: {name} is DROWSY ({time}). Call now and ask them to pull over safely.',
    microsleep:
      'Guardian Drive: {name} briefly FELL ASLEEP at the wheel ({time}). Call now and ask them to pull over.',
    where: 'Location: {map}',
  },
  fil: {
    drowsy:
      'Guardian Drive: Inaantok si {name} ({time}). Tawagan na at pakisabing tumabi muna nang ligtas.',
    microsleep:
      'Guardian Drive: Saglit na nakatulog si {name} habang nagmamaneho ({time}). Tawagan na at pakisabing tumabi.',
    where: 'Lokasyon: {map}',
  },
  ceb: {
    drowsy:
      'Guardian Drive: Gikatulgon si {name} ({time}). Tawagi karon ug sultihi nga mohunong una nga luwas.',
    microsleep:
      'Guardian Drive: Kadiyot nakatulog si {name} samtang nagdrayb ({time}). Tawagi karon ug pahunonga.',
    where: 'Lokasyon: {map}',
  },
};

/** The text for an alert, in the parent's language (others fall back to English). */
function buildText({ type, driverName, at, location, language }) {
  const t = TEMPLATES[language] || TEMPLATES.en;
  const time = new Intl.DateTimeFormat('en-PH', {
    timeZone: env.alertTimezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
  let text = t[type].replace('{name}', driverName).replace('{time}', time);
  if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
    const map = `https://maps.google.com/?q=${location.lat.toFixed(5)},${location.lng.toFixed(5)}`;
    text += ` ${t.where.replace('{map}', map)}`;
  }
  return text;
}

function underParentLimit(parentId, now) {
  const key = `${parentId}:${new Date(now).toISOString().slice(0, 10)}`;
  const n = perParent.get(key) || 0;
  if (n >= env.sms.perParentDaily) return false;
  if (perParent.size > 10_000) perParent.clear();
  perParent.set(key, n + 1);
  return true;
}

/**
 * Text the parent about this alert if it qualifies. Resolves to the sms status (or null when
 * nothing was attempted). Never throws.
 */
async function notifyAlert(alert, driver) {
  try {
    if (!TEXT_TYPES.has(alert.type) || !sms.canSendSms()) return null;
    if (alert.delayedS && alert.delayedS > STALE_S) return null;
    // Claim the alert first: concurrent readings (or an escalation) must not text twice.
    const claimed = await Alert.findOneAndUpdate(
      { _id: alert._id, sms: { $exists: false } },
      { sms: { status: 'sending', at: new Date() } },
      { new: true },
    );
    if (!claimed) return null;

    const parent = await User.findById(alert.parentId).select('phone language');
    const to = sms.normalizePhone(parent && parent.phone);
    const finish = (sms_) =>
      Alert.updateOne({ _id: alert._id }, { sms: sms_ }).then(() => sms_.status);
    if (!to) return finish({ status: 'no_phone', at: new Date() });
    if (!underParentLimit(alert.parentId.toString(), Date.now())) {
      return finish({ status: 'limit', to: sms.maskPhone(to), at: new Date() });
    }
    const text = buildText({
      type: alert.type,
      driverName: driver.name,
      at: alert.lastDetectedAt || alert.createdAt || new Date(),
      location: alert.location,
      language: parent.language,
    });
    try {
      await sms.sendSms(to, text);
      logger.info({ alertId: alert._id.toString(), to: sms.maskPhone(to) }, 'drowsy alert texted');
      return finish({ status: 'sent', to: sms.maskPhone(to), at: new Date() });
    } catch (err) {
      logger.warn({ alertId: alert._id.toString(), err: err.message }, 'alert text failed');
      return finish({
        status: 'failed',
        to: sms.maskPhone(to),
        at: new Date(),
        error: err.message.slice(0, 200),
      });
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'alert text skipped');
    return null;
  }
}

function _reset() {
  perParent.clear();
}

module.exports = { notifyAlert, buildText, TEXT_TYPES, _reset };
