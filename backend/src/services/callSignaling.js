const crypto = require('crypto');
const { env } = require('../config/env');
const logger = require('../config/logger');
const Driver = require('../models/Driver');
const User = require('../models/User');

/**
 * Parent -> in-car device voice calls (WebRTC audio). The server only relays the call set-up
 * (offer / answer / ICE candidates); the audio itself flows directly between the two peers,
 * or through a TURN relay when one is configured (TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL).
 *
 * Flow: parent `call:start` -> device `call:incoming` (it rings, then auto-answers so the driver
 * never touches a screen) -> device `call:accept` -> parent `call:accepted` -> parent sends the
 * offer via `call:signal` -> device answers via `call:signal` -> audio. `call:end` from either side.
 */

const RING_TIMEOUT_MS = 30 * 1000;
let ioRef = null; // set when the first socket attaches (messages are sent from REST handlers)
const deviceRoom = (driverId) => `device:${driverId}`;
const calls = new Map(); // callId -> { driverId, parentId, parentSocket, deviceSocket, state, timer }

function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const urls = (process.env.TURN_URLS || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length) {
    list.push({
      urls,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  return list;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** In-car device handshake: the ingest key + the driver it is monitoring. */
async function authenticateDevice(auth) {
  if (!auth || !auth.deviceKey || !auth.driverId || !env.ingestApiKey) return null;
  if (!safeEqual(auth.deviceKey, env.ingestApiKey)) return null;
  const driver = await Driver.findById(auth.driverId)
    .select('_id parentId name')
    .lean()
    .catch(() => null);
  if (!driver) return null;
  return {
    driverId: driver._id.toString(),
    parentId: driver.parentId.toString(),
    name: driver.name,
  };
}

function end(io, callId, reason, by) {
  const call = calls.get(callId);
  if (!call) return;
  clearTimeout(call.timer);
  calls.delete(callId);
  const payload = { callId, reason };
  if (by !== 'parent') io.to(call.parentSocket).emit('call:ended', payload);
  if (by !== 'device') {
    if (call.deviceSocket) io.to(call.deviceSocket).emit('call:ended', payload);
    else io.to(deviceRoom(call.driverId)).emit('call:ended', payload);
  }
  logger.info({ callId, driverId: call.driverId, reason }, 'call ended');
}

function activeCallFor(driverId) {
  for (const [id, c] of calls) if (c.driverId === driverId) return id;
  return null;
}

/** A parent's socket: start / signal / end calls to their own drivers. */
function attachParent(io, socket) {
  ioRef = io;
  const { parentId } = socket.data.user;

  socket.on('call:start', async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const driverId = payload && payload.driverId;
      const driver =
        driverId && (await Driver.findOne({ _id: driverId, parentId }).select('name').lean());
      if (!driver) return reply({ ok: false, error: 'not_found' });
      const devices = await io.in(deviceRoom(driverId)).fetchSockets();
      if (!devices.length) return reply({ ok: false, error: 'offline' });
      if (activeCallFor(driverId)) return reply({ ok: false, error: 'busy' });
      const user = await User.findById(parentId).select('name').lean();
      const callId = crypto.randomUUID();
      calls.set(callId, {
        driverId,
        parentId,
        parentSocket: socket.id,
        deviceSocket: null,
        state: 'ringing',
        timer: setTimeout(() => end(io, callId, 'no_answer'), RING_TIMEOUT_MS),
      });
      io.to(deviceRoom(driverId)).emit('call:incoming', {
        callId,
        callerName: (user && user.name) || 'Your parent',
        iceServers: iceServers(),
      });
      logger.info({ callId, driverId }, 'call ringing');
      return reply({ ok: true, callId, driverName: driver.name, iceServers: iceServers() });
    } catch (err) {
      logger.warn({ err: err.message }, 'call:start failed');
      return reply({ ok: false, error: 'failed' });
    }
  });

  socket.on('call:signal', ({ callId, data } = {}) => {
    const call = calls.get(callId);
    if (!call || call.parentSocket !== socket.id || !call.deviceSocket) return;
    io.to(call.deviceSocket).emit('call:signal', { callId, data });
  });

  socket.on('call:end', ({ callId } = {}) => {
    const call = calls.get(callId);
    if (call && call.parentSocket === socket.id) end(io, callId, 'hangup', 'parent');
  });

  socket.on('disconnect', () => {
    for (const [id, c] of calls)
      if (c.parentSocket === socket.id) end(io, id, 'disconnected', 'parent');
  });
}

/** An in-car device's socket: answer / decline / signal / end. */
function attachDevice(io, socket) {
  ioRef = io;
  const { driverId } = socket.data.device;
  socket.join(deviceRoom(driverId));
  deliverPending(socket, driverId).catch((err) =>
    logger.warn({ err: err.message }, 'pending messages'),
  );

  socket.on('message:delivered', ({ id } = {}) => {
    if (id)
      require('../controllers/messages.controller')
        .markDelivered(id, driverId)
        .catch(() => {});
  });

  socket.on('call:accept', ({ callId } = {}) => {
    const call = calls.get(callId);
    if (!call || call.driverId !== driverId || call.state !== 'ringing') return;
    clearTimeout(call.timer);
    call.state = 'connected';
    call.deviceSocket = socket.id;
    io.to(call.parentSocket).emit('call:accepted', { callId });
  });

  socket.on('call:decline', ({ callId } = {}) => {
    const call = calls.get(callId);
    if (call && call.driverId === driverId) end(io, callId, 'declined', 'device');
  });

  socket.on('call:signal', ({ callId, data } = {}) => {
    const call = calls.get(callId);
    if (!call || call.deviceSocket !== socket.id) return;
    io.to(call.parentSocket).emit('call:signal', { callId, data });
  });

  socket.on('call:end', ({ callId } = {}) => {
    const call = calls.get(callId);
    if (call && call.deviceSocket === socket.id) end(io, callId, 'hangup', 'device');
  });

  socket.on('disconnect', () => {
    for (const [id, c] of calls)
      if (c.deviceSocket === socket.id) end(io, id, 'disconnected', 'device');
  });
}

/** Parent message -> the car, if it is connected now. Returns whether it was sent. */
async function deliverMessage(msg) {
  if (!ioRef) return false;
  const room = deviceRoom(msg.driverId.toString());
  const sockets = await ioRef.in(room).fetchSockets();
  if (!sockets.length) return false;
  ioRef.to(room).emit('driver:message', {
    id: msg._id.toString(),
    text: msg.text,
    kind: msg.kind,
    fromName: msg.fromName,
  });
  return true;
}

/** A car that just connected gets the messages that waited for it (recent ones only). */
async function deliverPending(socket, driverId) {
  const Message = require('../models/Message');
  const cutoff = new Date(Date.now() - Message.PENDING_TTL_MS);
  await Message.updateMany(
    { driverId, status: 'pending', createdAt: { $lt: cutoff } },
    { status: 'expired' },
  );
  const pending = await Message.find({ driverId, status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(5);
  for (const m of pending) {
    socket.emit('driver:message', {
      id: m._id.toString(),
      text: m.text,
      kind: m.kind,
      fromName: m.fromName,
    });
  }
}

function resetCalls() {
  for (const c of calls.values()) clearTimeout(c.timer);
  calls.clear();
}

module.exports = {
  authenticateDevice,
  attachParent,
  attachDevice,
  iceServers,
  resetCalls,
  deviceRoom,
  deliverMessage,
};
