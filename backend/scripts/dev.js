/**
 * Local dev launcher. If nothing is listening on the MONGO_URI host:port, start an embedded
 * MongoDB (mongodb-memory-server) with a persistent data folder, then start the server.
 * Use a real MongoDB (docker compose / Atlas) by simply having it running or pointing MONGO_URI at it.
 */
const net = require('net');
const path = require('path');
const fs = require('fs');
const { env } = require('../src/config/env');
const logger = require('../src/config/logger');

function isListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1000 }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const url = new URL(env.mongoUri.replace(/^mongodb(\+srv)?:/, 'http:'));
  const isLocal =
    ['localhost', '127.0.0.1'].includes(url.hostname) && !env.mongoUri.includes('+srv');
  const port = Number(url.port) || 27017;

  if (isLocal && !(await isListening('127.0.0.1', port))) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const dbPath = path.resolve(__dirname, '../.mongo-data');
    fs.mkdirSync(dbPath, { recursive: true });
    logger.info({ dbPath, port }, 'starting embedded MongoDB (first run downloads ~100 MB)');
    const mongod = await MongoMemoryServer.create({
      instance: { port, dbPath, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
    });
    process.on('exit', () => mongod.stop());
    logger.info({ uri: mongod.getUri() }, 'embedded MongoDB ready');
  }

  require('../src/server');
}

main().catch((err) => {
  logger.fatal({ err }, 'dev launcher failed');
  process.exit(1);
});
