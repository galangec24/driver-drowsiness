const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const env = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/guardian_drive',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  ingestApiKey: process.env.INGEST_API_KEY || '',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  fcm: {
    serverKey: process.env.FCM_SERVER_KEY || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
  },
  corsOrigins: list(process.env.CORS_ORIGIN),
  // Minimum gap between two alerts of the same type for the same driver.
  alertCooldownMs: Number(process.env.ALERT_COOLDOWN_MS) || 15000,
  // The family's day for "acknowledge by the end of the day" (src/utils/alertDay.js).
  alertTimezone: process.env.ALERT_TIMEZONE || 'Asia/Manila',
  // A new detection of the same kind within this many minutes updates the open alert
  // ("detected again") instead of creating another one.
  alertGroupMs: (Number(process.env.ALERT_GROUP_MINUTES) || 10) * 60 * 1000,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  // False-positive verifier (src/ml/fp-verifier.json). FP_VERIFIER=off disables it;
  // FP_VERIFIER_THRESHOLD overrides the threshold chosen at training time.
  fpVerifier: (process.env.FP_VERIFIER || 'on').toLowerCase() !== 'off',
  fpVerifierThreshold:
    process.env.FP_VERIFIER_THRESHOLD !== undefined && process.env.FP_VERIFIER_THRESHOLD !== ''
      ? Number(process.env.FP_VERIFIER_THRESHOLD)
      : null,
  // Accounts with these e-mails get the admin role (training console) at register/login.
  adminEmails: list(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  // E-mail (OTP verification). EMAIL_PROVIDER=brevo (HTTPS API, free 300/day) | console (dev log).
  email: {
    provider: (process.env.EMAIL_PROVIDER || '').toLowerCase(),
    brevoApiKey: process.env.BREVO_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    fromName: process.env.EMAIL_FROM_NAME || 'Guardian Drive',
  },
  // Never send more than this many e-mails per day (Brevo free plan: 300/day).
  emailDailyLimit: Number(process.env.EMAIL_DAILY_LIMIT) || 250,
  // "Continue with Google": OAuth client id(s) from Google Cloud Console (comma-separated; the
  // first is the Web client id the website and Android app use). Empty = Google sign-in off.
  googleClientIds: list(process.env.GOOGLE_CLIENT_ID),
  // Per-IP request limits on sign-in / code endpoints (off in tests unless a test turns them on).
  rateLimit:
    (process.env.RATE_LIMIT || (process.env.NODE_ENV === 'test' ? 'off' : 'on')).toLowerCase() !==
    'off',
  // New accounts must confirm their e-mail with a code before signing in. On by default whenever
  // an e-mail provider is configured; EMAIL_VERIFICATION=off disables it.
  emailVerification:
    (
      process.env.EMAIL_VERIFICATION || (process.env.EMAIL_PROVIDER ? 'on' : 'off')
    ).toLowerCase() !== 'off',
  // Training worker (admin console). Auto-detects the repo's venvs when not set; see docs/ADMIN.md.
  ml: {
    python: process.env.ML_PYTHON || '',
    monitorPython: process.env.MONITOR_PYTHON || '',
    mlDir: process.env.ML_DIR || path.resolve(__dirname, '../../../ml'),
    monitorDir: process.env.MONITOR_DIR || path.resolve(__dirname, '../../../driver_monitor'),
    // Where manually downloaded video datasets (UTA-RLDD, NTHU-DDD, YawDD) are placed.
    videosDir: process.env.VIDEO_DATASETS_DIR || path.resolve(__dirname, '../../../ml/data/videos'),
  },
};

function assertRequired() {
  const missing = [];
  if (!env.jwtSecret) missing.push('JWT_SECRET');
  if (!env.ingestApiKey) missing.push('INGEST_API_KEY');
  if (!env.mongoUri) missing.push('MONGO_URI');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = { env, assertRequired };
