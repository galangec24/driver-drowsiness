const { Router } = require('express');
const ctrl = require('../controllers/alerts.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();
router.use(requireAuth);

router.get('/', validate(ctrl.listQuerySchema, 'query'), asyncHandler(ctrl.list));
router.post('/read-all', validate(ctrl.readAllSchema), asyncHandler(ctrl.markAllRead));
router.post('/remove', validate(ctrl.removeSchema), asyncHandler(ctrl.remove));
router.patch('/:id/read', validate(ctrl.readSchema), asyncHandler(ctrl.markRead));
router.delete('/:id', asyncHandler(ctrl.remove));
router.patch('/:id/ack', validate(ctrl.ackSchema), asyncHandler(ctrl.acknowledge));
router.patch('/:id/feedback', validate(ctrl.feedbackSchema), asyncHandler(ctrl.feedback));

module.exports = router;
