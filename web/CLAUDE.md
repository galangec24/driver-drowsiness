# CLAUDE.md — Web (React + Vite + Tailwind + PWA, 3D Design)

> **Read `../CLAUDE.md` first.** This file extends it. When a rule here conflicts with the root file, **this file wins for `web/`**.
>
> **last_updated:** 2026-10-07

---

## 1. Scope
Governs everything under `web/`. This is the parent's web access point — a React PWA with a **3D design language**. Credential-free.

---

## 2. Stack (Fixed)
- React 18 + Vite
- TypeScript (strict)
- Tailwind CSS 3
- Framer Motion (for 3D-feel motion)
- React Query (TanStack Query) for server state
- Axios for HTTP
- `socket.io-client` for live alerts
- `react-router-dom` v6 for routing
- `vite-plugin-pwa` for PWA (manifest + service worker)
- Deployed to Firebase Hosting

Do not add Redux. React Query + local state is enough.

---

## 3. THE 3D DESIGN LANGUAGE (Non-Negotiable)

"3D" here means **depth, layering, and motion** — not Three.js, not 3D models. Every surface should feel physically present.

### 3.1 Design Tokens (Tailwind config)

```js
// tailwind.config.js — theme.extend
{
  colors: {
    glass: {
      light: 'rgba(255,255,255,0.08)',
      border: 'rgba(255,255,255,0.15)',
      hover: 'rgba(255,255,255,0.12)',
    },
    accent: {
      primary: '#6366f1',
      glow: '#818cf8',
      danger: '#ef4444',
      warn: '#f59e0b',
      ok: '#10b981',
    },
  },
  boxShadow: {
    'depth-1': '0 1px 2px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.06)',
    'depth-2': '0 4px 8px rgba(0,0,0,0.10), 0 8px 16px rgba(0,0,0,0.08)',
    'depth-3': '0 10px 20px rgba(0,0,0,0.12), 0 20px 40px rgba(0,0,0,0.10)',
    'glow':    '0 0 24px rgba(99,102,241,0.45)',
    'glow-danger': '0 0 24px rgba(239,68,68,0.55)',
  },
  backdropBlur: { glass: '12px' },
  animation: {
    'float': 'float 6s ease-in-out infinite',
    'tilt':  'tilt 0.3s ease-out',
    'pulse-slow': 'pulse 3s ease-in-out infinite',
  },
}
3.2 Component Rules
Every card:

bg-glass-light + backdrop-blur-glass + border border-glass-border

shadow-depth-2 at rest, shadow-depth-3 on hover

rounded-2xl

Framer Motion whileHover={{ y: -4, scale: 1.01 }}

Every button:

shadow-depth-1, transitions to shadow-glow on hover for primary actions

active:translate-y-px for tactile feedback

Every list item:

Subtle whileHover={{ x: 4 }} slide

AnimatePresence for enter/exit

Alert cards (drowsy):

shadow-glow-danger + animate-pulse-slow

Red gradient border on the leading edge

3.3 Layout
Background: subtle radial gradient or animated mesh gradient

Floating cards with layered depth

Side rail on desktop (>1024px), bottom nav on mobile (<640px)

Content max-width: 1280px centered

3.4 Motion
Page transitions: fade + slide-y 8px, 200ms

Card enter: fade + scale 0.98 → 1, 250ms

Alert appear: slide-x + glow pulse, 400ms

Never use motion longer than 400ms

4. Directory Structure
text
web/
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── index.html
├── public/
│   ├── manifest.webmanifest
│   └── icons/
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── router.tsx
    ├── api/
    │   ├── client.ts           ← Axios instance with JWT interceptor
    │   ├── auth.ts
    │   ├── drivers.ts
    │   └── alerts.ts
    ├── socket/
    │   └── socket.ts           ← socket.io-client setup
    ├── store/
    │   └── auth.ts             ← JWT storage (localStorage + context)
    ├── components/
    │   ├── layout/
    │   │   ├── SideRail.tsx
    │   │   ├── BottomNav.tsx
    │   │   └── AppShell.tsx
    │   ├── ui/
    │   │   ├── GlassCard.tsx
    │   │   ├── DepthButton.tsx
    │   │   ├── FloatingInput.tsx
    │   │   └── Toast.tsx
    │   ├── driver/
    │   │   ├── DriverCard.tsx
    │   │   └── DriverList.tsx
    │   └── alert/
    │       ├── AlertCard.tsx
    │       └── AlertFeed.tsx
    ├── pages/
    │   ├── LoginPage.tsx
    │   ├── DashboardPage.tsx
    │   ├── DriversPage.tsx
    │   ├── RegisterDriverPage.tsx
    │   ├── DriverDetailPage.tsx
    │   ├── AlertsPage.tsx
    │   └── SettingsPage.tsx
    └── styles/
        └── index.css           ← Tailwind + global glass utilities
5. Credential Rules (Hard)
No API keys in web/. Ever.

Firebase config for Web Push goes through a backend proxy endpoint that returns a short-lived token.

Cloudinary uploads happen server-side — the client sends base64 to our backend, backend uploads to Cloudinary, returns URL.

Face embeddings never reach the client.

VITE_* env vars are public — never put secrets in them.

6. PWA Requirements
manifest.webmanifest with name, icons, theme color, display: standalone

Service worker caches: app shell, static assets, last 50 alerts

Offline: show cached drivers and alerts with a "Last updated" timestamp

Web Push: register via FCM, send token to backend

Install prompt: show a custom "Install Guardian Drive" banner after 2nd visit

7. Face Registration UI
Camera capture via getUserMedia or file upload

Multi-photo enrollment: 3 angles (front, left, right)

Quality feedback (blur, lighting) shown live

On submit: send base64 to POST /api/drivers → backend enrolls → returns driverId

Never compute embeddings in the browser

8. Real-time Rules
On login, open one Socket.io connection

On alert:new, prepend to alert feed with AnimatePresence, show toast, pulse the driver card

On alert:acknowledged, update that alert in place

Reconnect logic: exponential backoff, max 30s

If socket drops, fall back to React Query polling every 10s

9. Testing
Vitest + React Testing Library

Required tests: GlassCard, AlertCard, AppShell responsive behavior

Playwright smoke test: login → dashboard → acknowledge alert

10. Build & Deploy
bash
npm install
npm run dev            # localhost:5173
npm run build          # → dist/
firebase deploy --only hosting
11. Anti-Patterns
❌ Don't	✅ Do
Put API keys in .env (VITE_*)	Proxy through backend
Compute embeddings in browser	Send image to backend
Use Redux	React Query + local state
Motion longer than 400ms	Keep it snappy
Flat UI	Glass + depth + glow
Direct Firebase SDK for data	Call our backend
console.log in prod	Use a logger
last_updated: 2026-10-07

---

## 12. Implementation Decisions (2026-10-07)

- **Breakpoints:** bottom nav < 640 px; icon-only side rail 640–1024 px; full side rail with labels ≥ 1024 px.
- **Pulse:** `animate-pulse-slow` is applied to a glow layer behind drowsy cards, not the card itself, so text stays fully opaque.
- **Charts:** dependency-free SVG `LineChart` (no chart library).
- **Offline:** service worker (Workbox NetworkFirst for `/api/drivers*` and `/api/alerts*`, CacheFirst for `/uploads/*`) plus a localStorage snapshot that powers the "Last updated" banner.
- **Web Push:** `GET /api/push/config` decides; until FCM is configured, browser `Notification`s are shown for alerts while the tab is hidden.
- **Node 25+ test quirk:** `src/test/setup.ts` rebinds `localStorage`/`sessionStorage` to jsdom's, because Node's own experimental Web Storage global shadows them.
- **E2E:** Playwright runs on the installed Microsoft Edge (`channel: 'msedge'`) — no browser download.
