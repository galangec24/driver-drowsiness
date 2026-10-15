const { Router } = require('express');
const ctrl = require('../controllers/feedback.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');
const { rateLimit } = require('../middleware/rateLimit.middleware');

const router = Router();
router.use(requireAuth);

// Keeps an account from flooding the inbox (and storage) with attachments.
const sendLimit = rateLimit({
  name: 'feedback-user',
  windowMs: 60 * 60 * 1000,
  max: 10,
  key: (req) => req.user.parentId,
  message: 'You have sent a lot of feedback in the last hour. Please try again later.',
});

router.post('/', sendLimit, validate(ctrl.createSchema), asyncHandler(ctrl.create));
router.get('/mine', asyncHandler(ctrl.mine));

module.exports = router;
