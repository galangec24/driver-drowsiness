const { env } = require('../config/env');
const logger = require('../config/logger');

/**
 * FCM push hook. Stubbed until a Firebase project is configured: when FCM_SERVER_KEY
 * and FIREBASE_PROJECT_ID are empty this is a no-op. Socket.io remains the primary channel.
 */
function isEnabled() {
  return Boolean(env.fcm.serverKey && env.fcm.projectId);
}

async function sendToToken(token, notification, data) {
  if (!isEnabled() || !token) return { sent: false, reason: 'fcm-disabled' };
  // Integration point for firebase-admin messaging().send(...).
  logger.info({ title: notification.title, data }, 'fcm push (stub)');
  return { sent: false, reason: 'stub' };
}

module.exports = { isEnabled, sendToToken };
