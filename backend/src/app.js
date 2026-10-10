const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const logger = require('./config/logger');
const { env } = require('./config/env');
const { notFound, errorHandler } = require('./middleware/error.middleware');

const authRoutes = require('./routes/auth.routes');
const driversRoutes = require('./routes/drivers.routes');
const ingestRoutes = require('./routes/ingest.routes');
const alertsRoutes = require('./routes/alerts.routes');
const pushRoutes = require('./routes/push.routes');
const adminRoutes = require('./routes/admin.routes');

function corsOptions() {
  // Native mobile clients send no Origin header; browsers must be on the allow-list.
  return {
    origin(origin, cb) {
      if (!origin || env.corsOrigins.includes('*') || env.corsOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
  };
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors(corsOptions()));
  // Face enrollment sends up to 3 base64 photos.
  app.use(express.json({ limit: '15mb' }));
  if (env.nodeEnv !== 'test') {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  // Reference photos when Cloudinary is not configured (local dev fallback).
  app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), { maxAge: '7d' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/drivers', driversRoutes);
  app.use('/api/ingest', ingestRoutes);
  app.use('/api/alerts', alertsRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
