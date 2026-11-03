const mongoose = require('mongoose');
const logger = require('./logger');

async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    // Concurrent requests each need a connection: keep a few warm (no handshake on the first
    // reading after a quiet spell) and allow enough for bursts. MONGO_POOL_SIZE overrides.
    maxPoolSize: Number(process.env.MONGO_POOL_SIZE) || 50,
    minPoolSize: 2,
  });
  logger.info({ db: mongoose.connection.name }, 'mongo connected');
  return mongoose.connection;
}

async function disconnectDb() {
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb };
