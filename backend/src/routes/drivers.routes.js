const { Router } = require('express');
const ctrl = require('../controllers/drivers.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(ctrl.list));
router.post('/', validate(ctrl.createDriverSchema), asyncHandler(ctrl.create));
router.get('/:id', asyncHandler(ctrl.get));
router.patch(
  '/:id/thresholds',
  validate(ctrl.thresholdsSchema),
  asyncHandler(ctrl.updateThresholds),
);
router.get('/:id/logs', asyncHandler(ctrl.logs));
router.post('/:id/verify', validate(ctrl.verifySchema), asyncHandler(ctrl.verify));
router.delete('/:id', asyncHandler(ctrl.remove));

module.exports = router;
