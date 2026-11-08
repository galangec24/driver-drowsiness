/**
 * TESTING PHASE: the phone-browser driver monitor.
 *
 * Admins (any family's driver) and parent accounts an admin created (their own drivers only)
 * create a personal monitor link; whoever opens it (the test driver, on their own phone) runs the
 * same monitor as the in-car device in the browser. Self-registered parents never see it. The link
 * replaces the device API key: it can only send readings, alert photos and "away" for that one
 * driver, and nothing else (no alerts, no other drivers, no account). Revocable, expiring.
 * DRIVER_MONITOR_WEB=off turns all of it off.
 */
const { z } = require('zod');
const Driver = require('../models/Driver');
const User = require('../models/User');
const MonitorLink = require('../models/MonitorLink');
const HttpError = require('../utils/httpError');
const { env } = require('../config/env');
const { resolveThresholds } = require('../services/fusionEngine');
const modelRegistry = require('../services/modelRegistry');

const MAX_ACTIVE_PER_DRIVER = 5;
const TOUCH_EVERY_MS = 60 * 1000;

const createSchema = z.object({
  driverId: z.string().regex(/^[a-f0-9]{24}$/i, 'must be a 24-char hex ObjectId'),
  days: z.number().int().min(1).max(30).optional().default(7),
});

function enabled(_req, _res, next) {
  if (!env.driverMonitorWeb)
    return next(new HttpError(404, 'The web driver monitor is turned off'));
  return next();
}

// ------------------------------------------------------------------ admin / admin-created parents

/** After requireAuth: admins, and parent accounts an admin created (re-read from the database). */
async function requireMonitorAccess(req, _res, next) {
  const user = await User.findById(req.user.parentId).select('role createdByAdmin').lean();
  if (!user || !(user.role === 'admin' || user.createdByAdmin)) {
    throw new HttpError(403, 'The phone monitor is not available for this account');
  }
  req.user.role = user.role;
  next();
}

/** Admins: any driver. Admin-created parents: their own drivers only. */
async function findDriver(req, driverId) {
  const filter = {
    _id: driverId,
    ...(req.user.role !== 'admin' && { parentId: req.user.parentId }),
  };
  const driver = await Driver.findOne(filter).select('name parentId');
  if (!driver) throw new HttpError(404, 'Driver not found');
  return driver;
}

/** POST /api/monitor/links {driverId, days?}: the link's secret is returned only here. */
async function createLink(req, res) {
  const driver = await findDriver(req, req.body.driverId);
  const active = await MonitorLink.countDocuments({
    driverId: driver._id,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (active >= MAX_ACTIVE_PER_DRIVER) {
    throw new HttpError(
      409,
      `This driver already has ${MAX_ACTIVE_PER_DRIVER} active links: revoke one first`,
    );
  }
  const token = MonitorLink.newToken();
  const link = await MonitorLink.create({
    // The family whose driver this is (their alerts and dashboard receive the readings).
    parentId: driver.parentId,
    driverId: driver._id,
    tokenHash: MonitorLink.hash(token),
    expiresAt: new Date(Date.now() + req.body.days * 24 * 3600 * 1000),
  });
  res.status(201).json({ link: link.toPublic(), token });
}

/** GET /api/monitor/links?driverId= : this driver's links (never the secrets). */
async function listLinks(req, res) {
  const driverId = String(req.query.driverId || '');
  if (!/^[a-f0-9]{24}$/i.test(driverId)) throw new HttpError(400, 'driverId is required');
  await findDriver(req, driverId);
  const links = await MonitorLink.find({ driverId }).sort({ createdAt: -1 }).limit(20);
  res.json({ links: links.map((l) => l.toPublic()) });
}

/** DELETE /api/monitor/links/:id : the link stops working at once. */
async function revokeLink(req, res) {
  const link = await MonitorLink.findOneAndUpdate(
    {
      _id: req.params.id,
      revokedAt: null,
      ...(req.user.role !== 'admin' && { parentId: req.user.parentId }),
    },
    { revokedAt: new Date() },
    { new: true },
  );
  if (!link) throw new HttpError(404, 'Link not found');
  res.json({ link: link.toPublic() });
}

// ------------------------------------------------------------------ device (the monitor link)

/**
 * x-monitor-token → the link's driver. Every device request is for that driver only: the body's
 * driverId is replaced, so a link can never send readings for anyone else.
 */
async function requireMonitorToken(req, _res, next) {
  try {
    const token = req.headers['x-monitor-token'];
    if (typeof token !== 'string' || token.length < 16)
      throw new HttpError(401, 'Monitor link missing');
    const link = await MonitorLink.findOne({ tokenHash: MonitorLink.hash(token) });
    if (!link || link.revokedAt) throw new HttpError(401, 'This monitor link was revoked');
    if (link.expiresAt.getTime() <= Date.now())
      throw new HttpError(401, 'This monitor link has expired');
    req.monitorLink = link;
    if (req.body && typeof req.body === 'object') {
      req.body.driverId = link.driverId.toString();
      if (req.path === '/device/ingest') {
        req.body.source = 'web_monitor';
        // The link is for this driver: the reading can't claim someone else's face.
        if (req.body.signals && typeof req.body.signals === 'object') {
          req.body.signals.matchedDriver = req.body.driverId;
        }
      }
    }
    if (!link.lastUsedAt || Date.now() - link.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      MonitorLink.updateOne({ _id: link._id }, { lastUsedAt: new Date() }).catch(() => {});
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/** GET /api/monitor/device/session : who this link is for, and their personal thresholds. */
async function session(req, res) {
  const driver = await Driver.findById(req.monitorLink.driverId).select('name personalThresholds');
  if (!driver) throw new HttpError(404, 'Driver not found');
  const device = await modelRegistry.deviceSettings();
  res.json({
    driver: { id: driver._id.toString(), name: driver.name },
    expiresAt: req.monitorLink.expiresAt,
    personalThresholds: resolveThresholds(driver),
    device: { yawnMar: device.yawnMar },
  });
}

module.exports = {
  enabled,
  requireMonitorAccess,
  createSchema,
  createLink,
  listLinks,
  revokeLink,
  requireMonitorToken,
  session,
};
