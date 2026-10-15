const logger = require('../config/logger');
const User = require('../models/User');
const fcm = require('./fcm');

/** The only module allowed to emit Socket.io events. */
let io = null;

function setIO(instance) {
  io = instance;
}

const parentRoom = (parentId) => `parent:${parentId}`;
const driverRoom = (driverId) => `driver:${driverId}`;
const ADMIN_ROOM = 'admins';

/** Training console events (job status / log lines) — admins only. */
function emitToAdmins(event, payload) {
  if (!io) return;
  io.to(ADMIN_ROOM).emit(event, payload);
}

function emitToParent(parentId, event, payload) {
  if (!io) return;
  io.to(parentRoom(parentId)).emit(event, payload);
}

async function pushFcm(parentId, alert) {
  if (!fcm.isEnabled()) return;
  try {
    const user = await User.findById(parentId).select('+fcmToken').lean();
    await fcm.sendToToken(
      user && user.fcmToken,
      {
        title: `Guardian Drive: ${alert.type.toUpperCase()}`,
        body:
          `${alert.driverName || 'Driver'} - confidence ${Math.round(alert.confidence * 100)}%` +
          (alert.delayedS
            ? ` (happened ${Math.round(alert.delayedS / 60)} min ago, sent when the car was back online)`
            : ''),
      },
      { alertId: alert.id, driverId: alert.driverId, type: alert.type },
    );
  } catch (err) {
    logger.warn({ err: err.message }, 'fcm dispatch failed');
  }
}

/** alert is the public alert object (Alert#toPublic). */
function dispatchNewAlert(alert) {
  emitToParent(alert.parentId, 'alert:new', alert);
  // FCM is fire-and-forget so it never adds to ingest latency.
  pushFcm(alert.parentId, alert);
}

function dispatchAcknowledged(parentId, alertId, acknowledgedBy, falseAlarm) {
  emitToParent(parentId, 'alert:acknowledged', {
    alertId,
    acknowledgedBy,
    ...(typeof falseAlarm === 'boolean' && { falseAlarm }),
  });
}

/** Additive event: a parent labelled an alert as a (false) alarm. */
function dispatchFeedback(parentId, alertId, falseAlarm) {
  emitToParent(parentId, 'alert:feedback', { alertId, falseAlarm });
}

/** Additive event: fields of an existing alert changed (e.g. the driver snapshot arrived). */
function dispatchAlertUpdated(parentId, alertId, changes) {
  emitToParent(parentId, 'alert:updated', { alertId, ...changes });
}

function dispatchDriverStatus(parentId, status) {
  emitToParent(parentId, 'driver:status', status);
}

module.exports = {
  setIO,
  parentRoom,
  driverRoom,
  ADMIN_ROOM,
  emitToAdmins,
  dispatchNewAlert,
  dispatchAcknowledged,
  dispatchFeedback,
  dispatchAlertUpdated,
  dispatchDriverStatus,
};
