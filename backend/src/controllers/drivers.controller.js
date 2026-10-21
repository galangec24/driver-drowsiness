const { z } = require('zod');
const Driver = require('../models/Driver');
const SensorLog = require('../models/SensorLog');
const Alert = require('../models/Alert');
const Message = require('../models/Message');
const User = require('../models/User');
const HttpError = require('../utils/httpError');
const emailOtp = require('../services/emailOtp');
const { canSendMail } = require('../services/mailer');
const statusStore = require('../services/statusStore');
const { isReady, loadFaceModels } = require('../config/faceApi');
const { enrollPhotos, analyzePhoto, SAME_PERSON_DISTANCE } = require('../services/faceEnrollment');
const { compare, euclidean } = require('../services/faceMatcher');
const {
  storeReferencePhoto,
  removeReferencePhoto,
  removeAlertSnapshots,
} = require('../services/mediaStorage');

const photo = z.string().min(100, 'photo must be base64 image data');

const createDriverSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(80)
      .regex(/\p{L}/u, 'Name must contain letters'),
    relationship: z.string().trim().max(40).optional().default(''),
    // Either `photos` (front, left, right) or a single `photo`.
    photos: z.array(photo).min(1).max(3).optional(),
    photo: photo.optional(),
    // The parent confirmed that a face matching an existing driver is a different person (twins).
    confirmLookalike: z.boolean().optional().default(false),
  })
  .refine((v) => v.photos || v.photo, { message: 'At least one photo is required' });

/** One photo checked while it is being taken; `front` = the already accepted front photo. */
const checkPhotoSchema = z.object({ photo, front: photo.optional() });

const thresholdsSchema = z
  .object({
    earThreshold: z.number().min(0.05).max(0.5),
    perclosThreshold: z.number().min(0.05).max(1),
    drowsyDurationMs: z.number().int().min(250).max(30000),
    fusionWeightVision: z.number().min(0).max(1),
    fusionWeightPhysio: z.number().min(0).max(1),
    yawnThreshold: z.number().int().min(1).max(20),
    fusionWeightYawn: z.number().min(0.01).max(1),
    hrDropThreshold: z.number().min(0.05).max(0.5),
    breathDropThreshold: z.number().min(0.05).max(0.6),
    nodThreshold: z.number().int().min(1).max(10),
    fusionWeightNod: z.number().min(0.01).max(1),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No thresholds provided' });

const verifySchema = z.object({ photo });

function withStatus(driver) {
  const pub = driver.toPublic();
  const live = statusStore.get(pub.id);
  return {
    ...pub,
    status: live ? live.status : 'offline',
    lastUpdate: live ? live.lastUpdate : null,
    // The in-memory live fix is fresher than the throttled copy persisted on the driver.
    lastLocation: (live && live.location) || pub.lastLocation,
  };
}

const duplicateNameMessage = (name) =>
  `A driver named "${name}" is already registered. Driver names must be unique — ` +
  'for twins or relatives with the same name, add a middle name, suffix or nickname.';

/** 409 if this parent already has a driver whose name matches after normalisation. */
async function assertNameAvailable(parentId, name) {
  const existing = await Driver.findOne({ parentId, nameKey: Driver.nameKeyOf(name) })
    .select('name')
    .lean();
  if (existing) throw new HttpError(409, duplicateNameMessage(existing.name));
}

/**
 * Other drivers of this parent whose enrolled face is within the match distance of the new one
 * (twins / siblings). Not an error — the parent is told face verification may confuse them.
 */
async function similarFaces(parentId, embedding) {
  const others = await Driver.find({ parentId }).select('+faceEmbedding name').lean();
  return others
    .map((o) => ({
      driverId: o._id.toString(),
      name: o.name,
      ...compare(o.faceEmbedding, embedding),
    }))
    .filter((r) => r.match)
    .map(({ driverId, name, confidence }) => ({ driverId, name, confidence }));
}

async function findOwned(req) {
  const driver = await Driver.findOne({ _id: req.params.id, parentId: req.user.parentId });
  if (!driver) throw new HttpError(404, 'Driver not found');
  return driver;
}

async function ensureFaceModels() {
  if (isReady()) return;
  try {
    await loadFaceModels();
  } catch {
    throw new HttpError(503, 'Face recognition models are not available');
  }
}

async function list(req, res) {
  const drivers = await Driver.find({ parentId: req.user.parentId }).sort({ createdAt: 1 });
  res.json({ drivers: drivers.map(withStatus) });
}

async function create(req, res) {
  const { name, relationship } = req.body;
  const photos = req.body.photos || [req.body.photo];

  // Cheap check before the (slow) face enrollment; the unique index catches races.
  await assertNameAvailable(req.user.parentId, name);
  await ensureFaceModels();
  // Enroll first so a bad photo never leaves a half-created driver behind.
  const enrollment = await enrollPhotos(photos);
  const lookalikes = await similarFaces(req.user.parentId, enrollment.embedding);
  // Same face as a driver already registered: most likely a duplicate of that person. Twins are
  // the exception, so the parent can confirm and resubmit (confirmLookalike) instead of a hard block.
  if (lookalikes.length && !req.body.confirmLookalike) {
    const names = lookalikes.map((l) => l.name).join(', ');
    throw new HttpError(
      409,
      `This face matches ${names}, who is already registered. Register the same person only once. If this is a different person (for example a twin), confirm to continue.`,
      { code: 'FACE_MATCHES_DRIVER', matches: lookalikes },
    );
  }

  const driver = new Driver({
    parentId: req.user.parentId,
    name,
    relationship,
    faceEmbedding: enrollment.embedding,
    enrollment: { photoCount: photos.length, quality: enrollment.quality, enrolledAt: new Date() },
  });
  driver.referencePhotoUrl = await storeReferencePhoto(
    driver._id.toString(),
    enrollment.reference.buffer,
    enrollment.reference.format,
  );
  try {
    await driver.save();
  } catch (err) {
    if (err && err.code === 11000) {
      await removeReferencePhoto(driver._id.toString());
      throw new HttpError(409, duplicateNameMessage(name));
    }
    throw err;
  }

  res.status(201).json({
    driverId: driver._id.toString(),
    driver: withStatus(driver),
    quality: enrollment.quality,
    photos: enrollment.photos,
    // Lookalike drivers (e.g. twins): face verification may not tell them apart.
    similarFaces: lookalikes,
  });
}

const PHOTO_PROBLEM_TEXT = {
  no_face: 'No face found. Center the face in the oval with good light.',
  multiple_faces: 'More than one face. Only the driver should be in the photo.',
  different_person:
    "This doesn't look like the same person as the front photo. Retake it with the same driver.",
};

/**
 * POST /api/drivers/check-photo {photo, front?}: validate a photo the moment it is taken, before
 * it is accepted: exactly one face, and (side photos) the same person as the front photo. For the
 * front photo it also reports registered drivers with the same face (possible duplicate / twin).
 */
async function checkPhoto(req, res) {
  await ensureFaceModels();
  const fail = (problem, extra = {}) =>
    res.json({ ok: false, problem, message: PHOTO_PROBLEM_TEXT[problem], matches: [], ...extra });

  let probe;
  try {
    probe = await analyzePhoto(req.body.photo);
  } catch (err) {
    if (err.status === 422) return fail('no_face');
    throw err;
  }
  if (probe.faces > 1) return fail('multiple_faces', { quality: probe.quality });

  if (req.body.front) {
    let front;
    try {
      front = await analyzePhoto(req.body.front);
    } catch (err) {
      if (err.status === 422)
        throw new HttpError(400, 'The front photo has no face: retake it first');
      throw err;
    }
    const distance = euclidean(front.descriptor, probe.descriptor);
    if (distance > SAME_PERSON_DISTANCE)
      return fail('different_person', { quality: probe.quality });
    return res.json({
      ok: true,
      problem: null,
      message: null,
      quality: probe.quality,
      matches: [],
    });
  }
  const matches = await similarFaces(req.user.parentId, probe.descriptor);
  return res.json({ ok: true, problem: null, message: null, quality: probe.quality, matches });
}

async function get(req, res) {
  const driver = await findOwned(req);
  res.json({ driver: withStatus(driver) });
}

async function updateThresholds(req, res) {
  const driver = await findOwned(req);
  Object.assign(driver.personalThresholds, req.body);
  await driver.save();
  res.json({ driver: withStatus(driver) });
}

const removeSchema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/, 'Enter the 6-digit code')
    .optional(),
  // Only when the server can't send e-mail: type the driver's name instead.
  confirmName: z.string().max(80).optional(),
});

const DELETE_CODE_ERRORS = {
  invalid: [400, 'That code is not correct. Check the e-mail and try again.'],
  expired: [400, 'That code has expired. Ask for a new one.'],
  too_many_attempts: [429, 'Too many wrong codes. Ask for a new one.'],
  no_code: [400, 'Ask for a confirmation code first.'],
};

async function owner(req) {
  const user = await User.findById(req.user.parentId).select('+deleteOtp');
  if (!user) throw new HttpError(401, 'Account not found');
  return user;
}

/**
 * POST /drivers/:id/delete-code: e-mail the account owner a 6-digit code that authorizes
 * deleting this one driver. Without an e-mail provider the parent types the driver's name instead.
 */
async function requestDeleteCode(req, res) {
  const driver = await findOwned(req);
  if (!canSendMail()) return res.json({ method: 'name' });
  const user = await owner(req);
  let sent;
  try {
    sent = await emailOtp.issueCode(user, Date.now(), 'delete', {
      scope: driver._id.toString(),
      detail: `Driver: ${driver.name}`,
    });
  } catch (err) {
    const e = new HttpError(
      503,
      "We couldn't send the e-mail right now. Please try again in a few minutes.",
    );
    e.reason = err.message;
    throw e;
  }
  return res.json({
    method: 'email',
    email: user.email,
    sent: sent.sent,
    retryAfterS: sent.retryAfterS,
  });
}

async function remove(req, res) {
  const driver = await findOwned(req);
  const { code, confirmName } = req.body || {};
  if (canSendMail()) {
    if (!code) {
      throw new HttpError(400, 'Enter the code we e-mailed you to confirm.', {
        code: 'CODE_REQUIRED',
      });
    }
    const result = await emailOtp.verifyCode(
      await owner(req),
      code,
      Date.now(),
      'delete',
      driver._id.toString(),
    );
    if (result !== 'ok') {
      const [status, message] = DELETE_CODE_ERRORS[result];
      throw new HttpError(status, message, { code: result });
    }
  } else if ((confirmName || '').trim().toLowerCase() !== driver.name.trim().toLowerCase()) {
    throw new HttpError(400, "Type the driver's name exactly to confirm.", {
      code: 'NAME_REQUIRED',
    });
  }
  await driver.deleteOne();
  await Promise.all([
    SensorLog.deleteMany({ driverId: driver._id }),
    Alert.deleteMany({ driverId: driver._id }),
    Message.deleteMany({ driverId: driver._id }),
  ]);
  await removeReferencePhoto(driver._id.toString());
  await removeAlertSnapshots(driver._id.toString());
  res.status(204).end();
}

async function logs(req, res) {
  const driver = await findOwned(req);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 120));
  const rows = await SensorLog.find({ driverId: driver._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  res.json({
    logs: rows.reverse().map((r) => ({
      signals: r.signals,
      classification: r.classification,
      fusionScore: r.fusionScore,
      source: r.source,
      createdAt: r.createdAt,
    })),
  });
}

const EARTH_KM = 6371;
function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// GPS jitter while parked is not distance; a jump faster than this is a bad fix, not driving.
const MIN_STEP_KM = 0.015;
const MAX_KMH = 200;
const MINUTE = 60 * 1000;
const historySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * GET /drivers/:id/history?from&to (default: the last 24 h, at most 7 days): readings arrive about
 * once a second, so they are summarised per minute: time, worst state, averages, location, the km
 * driven since the previous minute and in total.
 */
async function history(req, res) {
  const driver = await findOwned(req);
  const q = historySchema.safeParse(req.query);
  if (!q.success) throw new HttpError(400, 'Invalid date range');
  const to = q.data.to || new Date();
  let from = q.data.from || new Date(to.getTime() - 24 * 3600 * 1000);
  if (to - from > 7 * 24 * 3600 * 1000) from = new Date(to.getTime() - 7 * 24 * 3600 * 1000);

  const ms = { $toLong: '$createdAt' };
  const buckets = await SensorLog.aggregate([
    { $match: { driverId: driver._id, createdAt: { $gte: from, $lte: to } } },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: { $subtract: [ms, { $mod: [ms, MINUTE] }] },
        firstAt: { $first: '$createdAt' },
        lastAt: { $last: '$createdAt' },
        readings: { $sum: 1 },
        ear: { $avg: '$signals.ear' },
        perclos: { $avg: '$signals.perclos' },
        heartRate: { $avg: '$signals.heartRate' },
        maxScore: { $max: '$fusionScore' },
        drowsy: { $sum: { $cond: [{ $eq: ['$classification', 'drowsy'] }, 1, 0] } },
        warning: { $sum: { $cond: [{ $eq: ['$classification', 'warning'] }, 1, 0] } },
        locations: { $push: '$location' },
        source: { $last: '$source' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const round = (v, d = 3) => (typeof v === 'number' ? Number(v.toFixed(d)) : null);
  let prev = null;
  let totalKm = 0;
  const rows = buckets.map((b) => {
    const locs = (b.locations || []).filter((l) => l && typeof l.lat === 'number');
    const loc = locs.length ? locs[locs.length - 1] : null;
    let km = 0;
    if (loc && prev) {
      const step = haversineKm(prev.loc, loc);
      const hours = Math.max(1 / 3600, (b.lastAt - prev.at) / 3600e3);
      if (step >= MIN_STEP_KM && step / hours <= MAX_KMH) km = step;
    }
    if (loc) prev = { loc, at: b.lastAt };
    totalKm += km;
    return {
      at: b.lastAt,
      from: b.firstAt,
      readings: b.readings,
      classification: b.drowsy ? 'drowsy' : b.warning ? 'warning' : 'alert',
      ear: round(b.ear),
      perclos: round(b.perclos),
      heartRate: round(b.heartRate, 0),
      fusionScore: round(b.maxScore),
      source: b.source,
      location: loc
        ? { lat: loc.lat, lng: loc.lng, ...(typeof loc.speed === 'number' && { speed: loc.speed }) }
        : null,
      km: round(km),
      totalKm: round(totalKm),
    };
  });

  const last = await SensorLog.findOne({ driverId: driver._id }).sort({ createdAt: -1 }).lean();
  res.json({
    from,
    to,
    totalKm: round(totalKm),
    lastReading: last
      ? {
          at: last.createdAt,
          classification: last.classification,
          fusionScore: last.fusionScore,
          source: last.source,
          signals: last.signals,
          location: last.location || null,
        }
      : null,
    rows: rows.reverse(), // newest first
  });
}

async function verify(req, res) {
  const driver = await Driver.findOne({ _id: req.params.id, parentId: req.user.parentId }).select(
    '+faceEmbedding',
  );
  if (!driver) throw new HttpError(404, 'Driver not found');
  if (!driver.faceEmbedding || !driver.faceEmbedding.length) {
    throw new HttpError(409, 'Driver has no enrolled face');
  }
  await ensureFaceModels();
  const probe = await analyzePhoto(req.body.photo);
  const { match, confidence } = compare(driver.faceEmbedding, probe.descriptor);
  res.json({ match, confidence });
}

module.exports = {
  list,
  create,
  get,
  updateThresholds,
  remove,
  removeSchema,
  requestDeleteCode,
  history,
  logs,
  verify,
  checkPhoto,
  checkPhotoSchema,
  createDriverSchema,
  thresholdsSchema,
  verifySchema,
};
