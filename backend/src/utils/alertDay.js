const { env } = require('../config/env');

/**
 * Alerts can be acknowledged only on the day they happened (the family's local day, ALERT_TIMEZONE,
 * default Asia/Manila). From the next day an unacknowledged alert is "expired": it is shown as
 * unacknowledged and can only be removed.
 */
function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, Number(x.value)]));
  return p;
}

/** Midnight today in `timeZone`, as an absolute Date. */
function startOfLocalDay(now = new Date(), timeZone = env.alertTimezone) {
  const p = localParts(now, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000; // tz offset in ms
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offset);
}

function isExpired(alert, now = new Date(), timeZone = env.alertTimezone) {
  if (!alert || alert.acknowledged) return false;
  return new Date(alert.createdAt).getTime() < startOfLocalDay(now, timeZone).getTime();
}

module.exports = { startOfLocalDay, isExpired };
