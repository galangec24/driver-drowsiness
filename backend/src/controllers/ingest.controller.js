const { z } = require('zod');
const logger = require('../config/logger');
const Driver = require('../models/Driver');
const Alert = require('../models/Alert');
const HttpError = require('../utils/httpError');
const { SOURCES } = require('../models/SensorLog');
const ingestService = require('../services/ingestService');
const { resolveThresholds } = require('../services/fusionEngine');
const modelRegistry = require('../services/modelRegistry');
const alertDispatcher = require('../services/alertDispatcher');
const { base64ToBuffer, sniff } = require('../services/imageDecoder');
const { storeAlertSnapshot } = require('../services/mediaStorage');
const User = require('../models/User');
const { analyzePhoto } = require('../services/faceEnrollment');
const { pickDriver } = require('../services/driverIdentifier');
const { loadFaceModels, isReady } = require('../config/faceApi');

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a 24-char hex ObjectId');
const finite = z.number().finite();

/** Optional GPS fix from the in-car device (additive field; the contract keys are unchanged). */
const locationSchema = z.object({
  lat: finite.min(-90).max(90),
  lng: finite.min(-180).max(180),
  heading: finite.min(0).max(360).optional().nullable(),
  speed: finite.min(0).max(400).optional().nullable(), // km/h
  accuracy: finite.min(0).optional().nullable(), // metres
});

/**
 * THE CONTRACT (root CLAUDE.md § 5.1). Field names are frozen.
 * Unknown extra fields are allowed so hardware can add optional signals later.
 */
const ingestSchema = z
  .object({
    driverId: objectId,
    source: z.enum(SOURCES),
    signals: z
      .object({
        ear: finite.optional(),
        perclos: finite.optional(),
        heartRate: finite.optional(),
        faceConfidence: finite.optional(),
        matchedDriver: z.string().optional().nullable(),
        // Optional additive signals (BLE wearable + yawn detector) — docs/WEARABLE.md
        hrv: finite.min(0).max(1000).optional(),
        hrBaseline: finite.min(0).max(250).optional(),
        hrvBaseline: finite.min(0).max(1000).optional(),
        yawnCount: z.number().int().min(0).max(100).optional(),
        nodCount: z.number().int().min(0).max(100).optional(),
        mar: finite.min(0).max(5).optional(),
        breathingRate: finite.min(0).max(60).optional(),
        breathingBaseline: finite.min(0).max(60).optional(),
      })
      .passthrough(),
    timestamp: z.string().datetime({ offset: true }).optional(),
    location: locationSchema.optional().nullable(),
    // Wearable link state, shown to the parent (not used for scoring).
    wearable: z
      .object({
        connected: z.boolean(),
        contact: z.boolean().optional().nullable(),
        battery: z.number().int().min(0).max(100).optional().nullable(),
        name: z.string().max(40).optional().nullable(),
      })
      .optional()
      .nullable(),
    // Dashboard radar link state (contactless heart rate + breathing), shown to the parent.
    radar: z
      .object({
        connected: z.boolean(),
        present: z.boolean().optional().nullable(),
        distanceCm: z.number().min(0).max(1000).optional().nullable(),
      })
      .optional()
      .nullable(),
  })
  .passthrough();

const SNAPSHOT_MAX_BYTES = 1.5 * 1024 * 1024;
// Only the frame of a fresh alert may be attached; stops a leaked key rewriting old evidence.
const SNAPSHOT_WINDOW_MS = 2 * 60 * 1000;

const snapshotSchema = z.object({
  driverId: objectId,
  alertId: objectId,
  image: z.string().min(100, 'image must be base64 JPEG/PNG data'),
});

/** Order of operations is fixed by backend/CLAUDE.md § 7 (validate + API key run as middleware). */
async function ingest(req, res) {
  const started = req.ingestStartedAt || process.hrtime.bigint();

  // 3. Load driver
  const driver = await Driver.findById(req.body.driverId);
  if (!driver) throw new HttpError(404, 'Driver not found');

  // 4–6. Fusion, SensorLog, Alert + dispatch (delegated to services)
  const result = await ingestService.processIngest(driver, req.body);

  // 7. Standard response shape — never rename/reorder.
  res.json({
    classification: result.classification,
    fusionScore: result.fusionScore,
    alertTriggered: result.alertTriggered,
    alertId: result.alertId,
  });

  // 8. Latency log
  const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
  logger.info(
    { driverId: req.body.driverId, classification: result.classification },
    `ingest_latency_ms=${latencyMs.toFixed(1)}`,
  );
}

/**
 * POST /api/ingest/snapshot — the in-car device uploads the camera frame for an alert it just
 * triggered (it learns the alertId from the ingest response). Parents get `alert:updated`.
 */
/** The car is registered to a family by the parent's account e-mail (FAMILY_EMAIL on the device). */
const identifySchema = z.object({
  family: z.string().trim().toLowerCase().email(),
  image: z.string().min(100, 'image must be base64 JPEG/PNG data'),
});

/**
 * POST /api/ingest/identify {family, image}: which of this family's drivers is in front of the
 * camera? The device calls it when someone sits down, then sends readings for that driver.
 * Answers 200 with driverId null when nobody matches, so the device just tries again.
 */
async function identify(req, res) {
  const parent = await User.findOne({ email: req.body.family }).select('_id');
  if (!parent) throw new HttpError(404, 'No Guardian Drive account uses that FAMILY_EMAIL');
  const drivers = await Driver.find({ parentId: parent._id }).select('+faceEmbedding name').lean();
  const enrolled = drivers.filter((d) => d.faceEmbedding && d.faceEmbedding.length);
  if (!enrolled.length) {
    throw new HttpError(
      409,
      'This family has no drivers with face photos yet: register one in the app',
    );
  }
  if (base64ToBuffer(req.body.image).length > SNAPSHOT_MAX_BYTES) {
    throw new HttpError(413, 'Image exceeds 1.5 MB');
  }
  if (!isReady()) {
    try {
      await loadFaceModels();
    } catch {
      throw new HttpError(503, 'Face recognition models are not available');
    }
  }
  let probe;
  try {
    probe = await analyzePhoto(req.body.image);
  } catch (err) {
    if (err.status === 422) {
      res.json({ driverId: null, confidence: 0, reason: 'no_face', drivers: enrolled.length });
      return;
    }
    throw err;
  }
  const result = pickDriver(enrolled, probe.descriptor);
  res.json({ ...result, drivers: enrolled.length });
}

async function snapshot(req, res) {
  const { driverId, alertId, image } = req.body;
  const alert = await Alert.findOne({ _id: alertId, driverId });
  if (!alert) throw new HttpError(404, 'Alert not found');
  if (Date.now() - alert.createdAt.getTime() > SNAPSHOT_WINDOW_MS) {
    throw new HttpError(409, 'Alert is too old to attach a snapshot');
  }
  const buffer = base64ToBuffer(image);
  if (buffer.length > SNAPSHOT_MAX_BYTES) throw new HttpError(413, 'Snapshot exceeds 1.5 MB');
  const format = sniff(buffer);
  if (!format) throw new HttpError(415, 'Unsupported image format (use JPEG or PNG)');

  alert.snapshotUrl = await storeAlertSnapshot(driverId, alertId, buffer, format);
  await alert.save();
  alertDispatcher.dispatchAlertUpdated(alert.parentId.toString(), alertId, {
    snapshotUrl: alert.snapshotUrl,
  });
  res.status(201).json({ snapshotUrl: alert.snapshotUrl });
}

/**
 * GET /api/ingest/drivers/:id/thresholds — the in-car device fetches the driver's personal
 * thresholds for its local, network-independent checks (e.g. microsleep → vibrate the watch).
 */
async function thresholds(req, res) {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) throw new HttpError(400, 'Invalid driver id');
  const driver = await Driver.findById(req.params.id).select('personalThresholds');
  if (!driver) throw new HttpError(404, 'Driver not found');
  const device = await modelRegistry.deviceSettings();
  res.json({
    personalThresholds: resolveThresholds(driver),
    // Admin-promoted on-device settings (null = keep the device's own default).
    device: { yawnMar: device.yawnMar, eyeStateVersion: device.eyeStateVersion },
  });
}

/** GET /api/ingest/models/eye-state — the admin-promoted eye model for in-car devices. */
async function eyeStateModel(_req, res) {
  const release = await modelRegistry.activeEyeModel();
  if (!release)
    throw new HttpError(404, 'No promoted eye-state model; devices keep their bundled one');
  res.json({ version: release._id.toString(), model: release.artifact });
}

function markStart(req, _res, next) {
  req.ingestStartedAt = process.hrtime.bigint();
  next();
}

module.exports = {
  ingest,
  ingestSchema,
  markStart,
  snapshot,
  snapshotSchema,
  identifySchema,
  identify,
  thresholds,
  eyeStateModel,
};
