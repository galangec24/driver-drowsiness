/**
 * TESTING PHASE: phone-browser driver monitor (controllers/monitor.controller.js).
 *   /links/*   admins, and parents an admin created: create / list / revoke monitor links
 *   /device/*  the monitor link (x-monitor-token): the same calls the in-car device makes
 */
const { Router } = require('express');
const ctrl = require('../controllers/monitor.controller');
const ingest = require('../controllers/ingest.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();
router.use(ctrl.enabled);

const admin = [requireAuth, asyncHandler(ctrl.requireMonitorAccess)];
router.post('/links', ...admin, validate(ctrl.createSchema), asyncHandler(ctrl.createLink));
router.get('/links', ...admin, asyncHandler(ctrl.listLinks));
router.delete('/links/:id', ...admin, asyncHandler(ctrl.revokeLink));

// The link's driver is set by requireMonitorToken before validation (the body can't choose it).
router.get('/device/session', ctrl.requireMonitorToken, asyncHandler(ctrl.session));
router.post(
  '/device/ingest',
  ingest.markStart,
  ctrl.requireMonitorToken,
  validate(ingest.ingestSchema),
  asyncHandler(ingest.ingest),
);
router.post(
  '/device/snapshot',
  ctrl.requireMonitorToken,
  validate(ingest.snapshotSchema),
  asyncHandler(ingest.snapshot),
);
router.post(
  '/device/away',
  ctrl.requireMonitorToken,
  validate(ingest.awaySchema),
  asyncHandler(ingest.away),
);

module.exports = router;
