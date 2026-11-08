/**
 * Keeps the Render free server awake.
 *
 * Render's free plan puts a web service to sleep after 15 minutes without incoming requests; the
 * next visitor then waits 30-70 s ("Waking up the server..."). While it is awake, the server calls
 * its own public address every 10 minutes, which counts as incoming traffic, so it never reaches
 * the 15 minutes and stays awake. One always-on free service uses ~744 of the 750 free hours a
 * month, so this only fits when it is the only free service in the Render workspace.
 *
 * The address is KEEP_ALIVE_URL, else RENDER_EXTERNAL_URL (set by Render itself). Off in tests,
 * locally (no address) and with KEEP_ALIVE=off.
 */
const logger = require('../config/logger');

const TEN_MINUTES = 10 * 60 * 1000;

function targetUrl(env = process.env) {
  if ((env.KEEP_ALIVE || '').toLowerCase() === 'off' || env.NODE_ENV === 'test') return '';
  const base = (env.KEEP_ALIVE_URL || env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/api/health` : '';
}

function schedule({ env = process.env, everyMs = TEN_MINUTES, fetchFn = globalThis.fetch } = {}) {
  const url = targetUrl(env);
  if (!url || typeof fetchFn !== 'function') return { url: '', stop: () => {} };
  const ping = () =>
    fetchFn(url, { signal: AbortSignal.timeout(30_000) }).catch((err) =>
      logger.warn({ err: err.message }, 'keep-alive ping failed'),
    );
  const timer = setInterval(ping, everyMs);
  timer.unref();
  logger.info({ url, everyMinutes: everyMs / 60000 }, 'keep-alive on');
  return { url, ping, stop: () => clearInterval(timer) };
}

module.exports = { targetUrl, schedule };
