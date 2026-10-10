import { defineConfig } from '@playwright/test';

/**
 * Smoke test against a running backend (npm run dev in backend/) + seeded demo data (npm run seed).
 * Uses the system Microsoft Edge so no browser download is needed; override with PW_CHANNEL=chrome.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: process.env.PW_CHANNEL || 'msedge',
    headless: true,
    viewport: { width: 1366, height: 860 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
