/**
 * Rasterise public/icons/icon.svg into the PWA + Android launcher PNGs.
 * Uses the system Microsoft Edge via Playwright (no browser download needed).
 *   node scripts/gen-icons.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(root, 'public/icons/icon.svg'), 'utf8');
const android = resolve(root, '../mobile_app/android/app/src/main/res');

const targets = [
  { out: 'public/icons/icon-192.png', size: 192 },
  { out: 'public/icons/icon-512.png', size: 512 },
  // Maskable: full-bleed background, logo inside the 80% safe zone.
  { out: 'public/icons/icon-maskable-512.png', size: 512, maskable: true },
  ...[
    ['mdpi', 48],
    ['hdpi', 72],
    ['xhdpi', 96],
    ['xxhdpi', 144],
    ['xxxhdpi', 192],
  ].map(([density, size]) => ({ out: `${android}/mipmap-${density}/ic_launcher.png`, size, absolute: true })),
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const page = await browser.newPage();
for (const t of targets) {
  const inner = t.maskable ? Math.round(t.size * 0.72) : t.size;
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;background:${t.maskable ? '#05060f' : 'transparent'};display:flex;align-items:center;justify-content:center;width:${t.size}px;height:${t.size}px">
       <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
     </body></html>`,
  );
  const path = t.absolute ? t.out : resolve(root, t.out);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, omitBackground: !t.maskable });
  process.stdout.write(`wrote ${t.out.replace(android, 'android/res')} (${t.size}px)\n`);
}
await browser.close();
