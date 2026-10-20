const { Server } = require('socket.io');
const { env } = require('../config/env');
const logger = require('../config/logger');
const { verifyToken } = require('../middleware/auth.middleware');
const alertDispatcher = require('../services/alertDispatcher');
const statusStore = require('../services/statusStore');
const Driver = require('../models/Driver');
const { isAdmin } = require('../middleware/admin.middleware');
const calls = require('../services/callSignaling');

function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  // JWT handshake: auth.token (preferred) or Authorization header.
  io.use(async (socket, next) => {
    // In-car device (calls): the ingest key + its driver, instead of a parent's JWT.
    const auth = socket.handshake.auth || {};
    if (auth.deviceKey) {
      const device = await calls.authenticateDevice(auth);
      if (!device) return next(new Error('unauthorized'));
      socket.data.device = device;
      return next();
    }
    const fromAuth = socket.handshake.auth && socket.handshake.auth.token;
    const header = socket.handshake.headers.authorization || '';
    const token = fromAuth || (header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) return next(new Error('unauthorized'));
    try {
      socket.data.user = verifyToken(token);
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    if (socket.data.device) {
      calls.attachDevice(io, socket);
      logger.debug({ driverId: socket.data.device.driverId }, 'in-car device connected');
      return;
    }
    const { parentId } = socket.data.user;
    calls.attachParent(io, socket);
    socket.join(alertDispatcher.parentRoom(parentId));
    // Admins also receive training-job events (role checked in the DB, not trusted from the JWT).
    isAdmin(parentId)
      .then((admin) => admin && socket.join(alertDispatcher.ADMIN_ROOM))
      .catch(() => {});
    logger.debug({ parentId, socketId: socket.id }, 'socket connected');

    // Send current status of every driver so freshly opened clients are in sync.
    try {
      const drivers = await Driver.find({ parentId }).select('_id').lean();
      for (const d of drivers) {
        const status = statusStore.get(d._id.toString());
        if (status) socket.emit('driver:status', status);
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'initial status sync failed');
    }

    socket.on('subscribe:driver', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const driverId = payload && payload.driverId;
      try {
        const owned = driverId && (await Driver.exists({ _id: driverId, parentId }));
        if (!owned) return reply({ ok: false, error: 'not found' });
        socket.join(alertDispatcher.driverRoom(driverId));
        return reply({ ok: true });
      } catch {
        return reply({ ok: false, error: 'invalid driverId' });
      }
    });
  });

  alertDispatcher.setIO(io);
  return io;
}

module.exports = { initSockets };
