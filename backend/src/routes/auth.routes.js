const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');
const {
  codeEmailLimit,
  signInLimit,
  googleLimit,
  handoffLimit,
} = require('../middleware/rateLimit.middleware');

const router = Router();

// Limits run before validation so malformed floods are counted too.
router.get('/config', ctrl.config);
router.post(
  '/register',
  codeEmailLimit,
  validate(ctrl.registerSchema),
  asyncHandler(ctrl.register),
);
router.post('/login', signInLimit, validate(ctrl.loginSchema), asyncHandler(ctrl.login));
router.post(
  '/verify-email',
  signInLimit,
  validate(ctrl.verifySchema),
  asyncHandler(ctrl.verifyEmail),
);
router.post(
  '/resend-code',
  codeEmailLimit,
  validate(ctrl.resendSchema),
  asyncHandler(ctrl.resendCode),
);
router.post(
  '/forgot-password',
  codeEmailLimit,
  validate(ctrl.forgotSchema),
  asyncHandler(ctrl.forgotPassword),
);
router.post(
  '/reset-password',
  signInLimit,
  validate(ctrl.resetSchema),
  asyncHandler(ctrl.resetPassword),
);
router.post('/google', googleLimit, validate(ctrl.googleSchema), asyncHandler(ctrl.google));
// Apps poll this every ~2 s while the user signs in with Google in the browser.
router.get('/handoff/:id', handoffLimit, asyncHandler(ctrl.collectHandoff));
router.get('/me', requireAuth, asyncHandler(ctrl.me));
router.put(
  '/fcm-token',
  requireAuth,
  validate(ctrl.fcmTokenSchema),
  asyncHandler(ctrl.setFcmToken),
);

module.exports = router;
