/**
 * Ingest load test: many cars sending readings at the same time. Reports latency (p50/p95/p99)
 * and throughput per concurrency level. The system's target is < 500 ms from reading to parent.
 *
 *   node scripts/loadTest.js                         # throw-away in-memory MongoDB + API
 *   node scripts/loadTest.js --url https://api.example.com --key INGEST_KEY --drivers id1,id2
 *
 * Options: --levels 1,10,50,100  (requests in flight)  --requests 500  (per level)
 */
const http = require('http');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const LEVELS = arg('levels', '1,10,50,100').split(',').map(Number);
const REQUESTS = Number(arg('requests', 500));

function payload(driverId, i) {
  // Mostly normal driving with some drowsy readings, so alerts are created and merged too.
  const drowsy = i % 10 === 0;
  return {
    driverId,
    source: 'simulated',
    signals: drowsy
      ? { ear: 0.08, perclos: 0.6, heartRate: 50, faceConfidence: 0.9 }
      : { ear: 0.3, perclos: 0.05, heartRate: 72, faceConfidence: 0.95 },
    timestamp: new Date().toISOString(),
  };
}

async function runLevel(url, key, drivers, concurrency, total) {
  const times = [];
  let errors = 0;
  let next = 0;
  const started = Date.now();
  async function lane() {
    while (next < total) {
      const i = next++;
      const t = process.hrtime.bigint();
      const res = await fetch(`${url}/api/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify(payload(drivers[i % drivers.length], i)),
      }).catch(() => null);
      if (!res || res.status !== 200) errors += 1;
      else await res.arrayBuffer();
      times.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
  const secs = (Date.now() - started) / 1000;
  times.sort((a, b) => a - b);
  const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(1);
  return {
    concurrency,
    requests: total,
    errors,
    perSecond: Math.round(total / secs),
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    max: times[times.length - 1].toFixed(1),
  };
}

async function inMemoryStack() {
  process.env.NODE_ENV = 'test'; // quiet logs, no rate limits
  process.env.JWT_SECRET = 'load_test';
  process.env.INGEST_API_KEY = 'load_test_key';
  const mongoose = require('mongoose');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const { createApp } = require('../src/app');
  const { initSockets } = require('../src/sockets');
  const Driver = require('../src/models/Driver');
  const User = require('../src/models/User');

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { maxPoolSize: 50, minPoolSize: 2 });
  const server = http.createServer(createApp());
  const io = initSockets(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const parent = await User.create({ name: 'Load', email: 'load@example.com', role: 'parent' });
  const drivers = await Driver.insertMany(
    Array.from({ length: 50 }, (_, i) => ({ parentId: parent._id, name: `Car ${i}` })),
  );
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    key: 'load_test_key',
    drivers: drivers.map((d) => d._id.toString()),
    async stop() {
      io.close();
      await new Promise((r) => server.close(r));
      await mongoose.disconnect();
      await mongod.stop();
    },
  };
}

async function main() {
  const url = arg('url');
  const target = url
    ? { url, key: arg('key', process.env.INGEST_API_KEY || ''), drivers: arg('drivers', '').split(',') }
    : await inMemoryStack();
  if (!target.drivers[0]) throw new Error('--drivers id1,id2 is required with --url');
  console.log(`ingest load test → ${url || 'in-memory stack'}, ${target.drivers.length} cars`);
  await runLevel(target.url, target.key, target.drivers, 5, 50); // warm-up
  const rows = [];
  for (const level of LEVELS) rows.push(await runLevel(target.url, target.key, target.drivers, level, REQUESTS));
  console.table(rows);
  console.log(JSON.stringify(rows));
  if (target.stop) await target.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
