const mongoose = require('mongoose');
const logger = require('./logger');

async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  logger.info({ db: mongoose.connection.name }, 'mongo connected');
  return mongoose.connection;
}

async function disconnectDb() {
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb };
