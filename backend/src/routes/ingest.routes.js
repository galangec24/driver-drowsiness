const { Router } = require('express');
const ctrl = require('../controllers/ingest.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireApiKey } = require('../middleware/apiKey.middleware');

const router = Router();

// 1. Validate payload (zod) → 2. Verify API key → controller. Do not reorder.
router.post(
  '/',
  ctrl.markStart,
  validate(ctrl.ingestSchema),
  requireApiKey,
  asyncHandler(ctrl.ingest),
);

// Camera frame for an alert the device just triggered (same API key).
router.post('/snapshot', validate(ctrl.snapshotSchema), requireApiKey, asyncHandler(ctrl.snapshot));

// Personal thresholds for on-device checks (same API key).
router.get('/drivers/:id/thresholds', requireApiKey, asyncHandler(ctrl.thresholds));
// Admin-promoted eye open/closed model for the in-car monitor.
router.get('/models/eye-state', requireApiKey, asyncHandler(ctrl.eyeStateModel));

module.exports = router;
