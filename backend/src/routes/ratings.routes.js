const { Router } = require('express');
const ctrl = require('../controllers/ratings.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');
const { rateLimit } = require('../middleware/rateLimit.middleware');

const router = Router();

// Public: the average and the latest reviews (short names only) are shown in the apps.
router.get('/summary', asyncHandler(ctrl.summary));

router.use(requireAuth);
const rateLimiter = rateLimit({
  name: 'rating-user',
  windowMs: 60 * 60 * 1000,
  max: 20,
  key: (req) => req.user.parentId,
  message: 'You have changed your rating many times. Please try again later.',
});
router.get('/mine', asyncHandler(ctrl.mine));
router.put('/mine', rateLimiter, validate(ctrl.rateSchema), asyncHandler(ctrl.rate));
router.delete('/mine', asyncHandler(ctrl.remove));

module.exports = router;
