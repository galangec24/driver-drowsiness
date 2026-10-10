const { z } = require('zod');
const Driver = require('../models/Driver');
const SensorLog = require('../models/SensorLog');
const HttpError = require('../utils/httpError');
const statusStore = require('../services/statusStore');
const { isReady, loadFaceModels } = require('../config/faceApi');
const { enrollPhotos, analyzePhoto } = require('../services/faceEnrollment');
const { compare } = require('../services/faceMatcher');
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
  })
  .refine((v) => v.photos || v.photo, { message: 'At least one photo is required' });

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

async function remove(req, res) {
  const driver = await findOwned(req);
  await driver.deleteOne();
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
  logs,
  verify,
  createDriverSchema,
  thresholdsSchema,
  verifySchema,
};
