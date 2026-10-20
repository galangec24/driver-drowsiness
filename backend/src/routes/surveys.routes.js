const { Router } = require('express');
const ctrl = require('../controllers/surveys.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');

/** Users: answer open surveys. (Admin routes are in admin.routes.js under /api/admin/surveys.) */
const router = Router();
router.use(requireAuth);
router.get('/', asyncHandler(ctrl.openForUser));
router.post('/:id/responses', validate(ctrl.answerSchema), asyncHandler(ctrl.respond));

module.exports = router;
