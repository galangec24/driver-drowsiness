const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const fcm = require('../services/fcm');

const router = Router();

/**
 * Web Push config proxy. Clients ask the backend whether push is available instead of
 * shipping Firebase config. Returns { enabled:false } until FCM is configured.
 */
router.get('/config', requireAuth, (_req, res) => {
  res.json({ enabled: fcm.isEnabled() });
});

module.exports = router;
