// Loaded by jest before any module: deterministic, secret-free test config.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.INGEST_API_KEY = 'test_ingest_key';
process.env.CORS_ORIGIN = '*';
process.env.ALERT_COOLDOWN_MS = '15000';
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.FCM_SERVER_KEY = '';
