const { Router } = require('express');
const ctrl = require('../controllers/drivers.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(ctrl.list));
router.post('/', validate(ctrl.createDriverSchema), asyncHandler(ctrl.create));
router.post('/check-photo', validate(ctrl.checkPhotoSchema), asyncHandler(ctrl.checkPhoto));
router.get('/:id', asyncHandler(ctrl.get));
router.patch(
  '/:id/thresholds',
  validate(ctrl.thresholdsSchema),
  asyncHandler(ctrl.updateThresholds),
);
router.get('/:id/logs', asyncHandler(ctrl.logs));
router.get('/:id/history', asyncHandler(ctrl.history));

// Messages / reminders to the car (read aloud by the in-car voice)
const messages = require('../controllers/messages.controller');
router.get('/:id/messages', asyncHandler(messages.list));
router.post('/:id/messages', validate(messages.sendSchema), asyncHandler(messages.send));
router.post('/:id/verify', validate(ctrl.verifySchema), asyncHandler(ctrl.verify));
// Deleting needs a code e-mailed to the account owner (see requestDeleteCode).
router.post('/:id/delete-code', asyncHandler(ctrl.requestDeleteCode));
router.delete('/:id', validate(ctrl.removeSchema), asyncHandler(ctrl.remove));

module.exports = router;
