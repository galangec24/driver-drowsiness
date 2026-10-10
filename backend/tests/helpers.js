const fs = require('fs');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { io: ioClient } = require('socket.io-client');
const { createApp } = require('../src/app');
const { initSockets } = require('../src/sockets');
const Driver = require('../src/models/Driver');
const ingestService = require('../src/services/ingestService');
const statusStore = require('../src/services/statusStore');

const API_KEY = 'test_ingest_key';

/** Boots in-memory Mongo + app + Socket.io on a random port. */
async function startStack() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const app = createApp();
  const server = http.createServer(app);
  const io = initSockets(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    app,
    url: `http://127.0.0.1:${port}`,
    async reset() {
      await Promise.all(
        Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
      );
      ingestService.resetCooldowns();
      statusStore.clear();
    },
    async stop() {
      io.close();
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      await mongod.stop();
    },
  };
}

let counter = 0;
async function registerParent(app, overrides = {}) {
  counter += 1;
  const body = {
    name: `Parent ${counter}`,
    email: `parent${counter}_${Date.now()}@example.com`,
    password: 'supersecret1',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/register').send(body).expect(201);
  return { token: res.body.token, user: res.body.user, password: body.password };
}

/** Insert a driver directly (no face enrollment) for ingest/alert tests. */
let driverCounter = 0;
async function createDriver(parentId, thresholds = {}, name) {
  driverCounter += 1;
  return Driver.create({
    parentId,
    name: name || `Test Driver ${driverCounter}`,
    relationship: 'son',
    personalThresholds: thresholds,
  });
}

function ingestPayload(driverId, signals = {}, extra = {}) {
  return {
    driverId: driverId.toString(),
    source: 'simulated',
    signals: {
      ear: 0.3,
      perclos: 0.05,
      heartRate: 72,
      faceConfidence: 0.95,
      matchedDriver: driverId.toString(),
      ...signals,
    },
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

const DROWSY_SIGNALS = { ear: 0.08, perclos: 0.6, heartRate: 48 };
const WARNING_SIGNALS = { ear: 0.15, perclos: 0.35, heartRate: 52 };

function connectSocket(url, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function fixtureBase64(name) {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', name));
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

module.exports = {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  connectSocket,
  waitForEvent,
  fixtureBase64,
  DROWSY_SIGNALS,
  WARNING_SIGNALS,
};
