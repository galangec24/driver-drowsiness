/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { networkInterfaces } from 'node:os';
import pkg from './package.json' with { type: 'json' };

/** This PC's Wi-Fi/LAN IPv4, so the download page's QR code works from a phone during development. */
function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
    }
  }
  return '';
}

export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Dev server only: production builds never embed a private network address.
    __LAN_HOST__: JSON.stringify(command === 'serve' ? lanAddress() : ''),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // public/manifest.webmanifest is the source of truth.
      manifest: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'manifest.webmanifest'],
      workbox: {
        navigateFallback: '/index.html',
        // app.apk must reach the server as a real file download, never the SPA shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//, /^\/uploads\//, /^\/app\.apk$/],
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        runtimeCaching: [
          {
            // Last-known drivers/alerts for offline use (alerts are fetched 50 at a time).
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/drivers') || url.pathname.startsWith('/api/alerts'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'gd-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'gd-photos',
              expiration: { maxEntries: 50, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          data: ['@tanstack/react-query', 'axios', 'socket.io-client'],
        },
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
}));
