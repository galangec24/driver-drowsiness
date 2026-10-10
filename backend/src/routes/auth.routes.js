const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

router.post('/register', validate(ctrl.registerSchema), asyncHandler(ctrl.register));
router.post('/login', validate(ctrl.loginSchema), asyncHandler(ctrl.login));
router.get('/me', requireAuth, asyncHandler(ctrl.me));
router.put(
  '/fcm-token',
  requireAuth,
  validate(ctrl.fcmTokenSchema),
  asyncHandler(ctrl.setFcmToken),
);

module.exports = router;
