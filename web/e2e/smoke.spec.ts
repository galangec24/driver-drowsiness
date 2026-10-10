import { expect, test } from '@playwright/test';

/**
 * login → dashboard → live alert arrives via Socket.io → acknowledge.
 * Requires: backend running with seeded demo data, and E2E_INGEST_KEY set to the backend's
 * INGEST_API_KEY (the key never ships in the web bundle — the test plays the sensor's role).
 */
const API = process.env.E2E_API_URL || 'http://localhost:3000';
const EMAIL = process.env.E2E_EMAIL || 'demo@guardiandrive.app';
const PASSWORD = process.env.E2E_PASSWORD || 'guardian123';
const INGEST_KEY = process.env.E2E_INGEST_KEY || '';

test('login → dashboard → acknowledge a live alert', async ({ page, request }) => {
  test.skip(!INGEST_KEY, 'E2E_INGEST_KEY not set');

  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const driverCard = page.getByTestId('driver-card').first();
  await expect(driverCard).toBeVisible();
  const driverId = (await driverCard.getAttribute('href'))!.split('/').pop()!;
  await expect(page.getByTestId('side-rail').getByText('Live')).toBeVisible();

  // Play the sensor: a microsleep-level reading arrives at /api/ingest.
  const res = await request.post(`${API}/api/ingest`, {
    headers: { 'x-api-key': INGEST_KEY },
    data: {
      driverId,
      source: 'simulated',
      signals: { ear: 0.05, perclos: 0.8, heartRate: 47, faceConfidence: 0.9, matchedDriver: driverId },
      timestamp: new Date().toISOString(),
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();

  // The alert appears live (no reload) …
  const feed = page.getByTestId('alert-feed');
  if (body.alertTriggered) {
    const card = feed.getByTestId('alert-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    // … and can be acknowledged.
    await card.getByRole('button', { name: /^acknowledge$/i }).click();
    await expect(card.getByTestId('ack-label')).toContainText('Acknowledged via Web');
  } else {
    // Inside the backend's per-driver cooldown: acknowledge whatever is open.
    const open = feed.getByRole('button', { name: /^acknowledge$/i }).first();
    await open.click();
    await expect(feed.getByTestId('ack-label').first()).toBeVisible();
  }

  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
});
