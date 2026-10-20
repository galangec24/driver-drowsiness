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
const feedbackRoutes = require('./routes/feedback.routes');
const ratingsRoutes = require('./routes/ratings.routes');
const surveysRoutes = require('./routes/surveys.routes');

/**
 * Which code is running (shown in the apps' Settings → About, so it updates by itself on deploy):
 * Render sets RENDER_GIT_COMMIT; locally git is asked once at start.
 */
function readBuildInfo() {
  let commit = process.env.RENDER_GIT_COMMIT || '';
  if (!commit) {
    try {
      commit = require('child_process')
        .execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      commit = '';
    }
  }
  // One product version for everything: the apps' version (mobile_app/pubspec.yaml), raised per release.
  let version = require('../package.json').version;
  try {
    const pubspec = require('fs').readFileSync(
      path.resolve(__dirname, '../../mobile_app/pubspec.yaml'),
      'utf8',
    );
    version = (pubspec.match(/^version:\s*([\d.]+)/m) || [])[1] || version;
  } catch {
    // backend deployed on its own: keep package.json's version
  }
  return {
    version,
    commit: commit ? commit.slice(0, 7) : null,
    startedAt: new Date().toISOString(),
  };
}
const buildInfo = readBuildInfo();

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

  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', time: new Date().toISOString(), ...buildInfo }),
  );
  // The bare address is the API itself (no web page here): say so instead of a 404.
  app.get('/', (_req, res) =>
    res.json({
      name: 'Guardian Drive API',
      status: 'running',
      health: '/api/health',
      note: 'This is the backend. Open the Guardian Drive web app or Android app to use it.',
    }),
  );
  // Reference photos when Cloudinary is not configured (local dev fallback).
  app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), { maxAge: '7d' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/drivers', driversRoutes);
  app.use('/api/ingest', ingestRoutes);
  app.use('/api/alerts', alertsRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/feedback', feedbackRoutes);
  app.use('/api/ratings', ratingsRoutes);
  app.use('/api/surveys', surveysRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
