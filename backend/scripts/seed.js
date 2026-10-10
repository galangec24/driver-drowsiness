/**
 * Seed a demo parent + face-enrolled driver through the real HTTP API (backend must be running).
 * Usage: npm run seed  →  prints the driverId to put in cv-simulator/.env and driver_monitor/.env
 */
const fs = require('fs');
const path = require('path');
const { env } = require('../src/config/env');
const logger = require('../src/config/logger');

const API = process.env.API_URL || `http://localhost:${env.port}`;
const DEMO = {
  name: 'Demo Parent',
  email: process.env.SEED_EMAIL || 'demo@guardiandrive.app',
  password: process.env.SEED_PASSWORD || 'guardian123',
};

async function call(method, url, body, token) {
  const res = await fetch(`${API}/api${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function photo(name) {
  const file = path.resolve(__dirname, '../tests/fixtures', name);
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
}

async function main() {
  let auth = await call('POST', '/auth/login', { email: DEMO.email, password: DEMO.password });
  if (auth.status !== 200) {
    auth = await call('POST', '/auth/register', DEMO);
    if (auth.status !== 201) throw new Error(`register failed: ${JSON.stringify(auth.body)}`);
  }
  const { token } = auth.body;

  const list = await call('GET', '/drivers', null, token);
  let driver = list.body.drivers && list.body.drivers[0];
  if (!driver) {
    const created = await call(
      'POST',
      '/drivers',
      {
        name: 'Alex',
        relationship: 'daughter',
        photos: ['front', 'left', 'right'].map((a) => photo(`personA_${a}.jpg`)),
      },
      token,
    );
    if (created.status !== 201) throw new Error(`driver failed: ${JSON.stringify(created.body)}`);
    driver = created.body.driver;
  }

  logger.info(
    { email: DEMO.email, password: DEMO.password, driverId: driver.id, driver: driver.name },
    'seed complete',
  );
  process.stdout.write(`\nDRIVER_ID=${driver.id}\n`);
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'seed failed');
  process.exit(1);
});
