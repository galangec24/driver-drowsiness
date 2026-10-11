import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles/index.css';

// Service worker: app shell + static assets + last API responses (see vite.config.ts).
// autoUpdate: a newly deployed version activates and reloads the page; tabs and installed apps
// that stay open also look for one every hour.
const HOURLY = 60 * 60 * 1000;
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (registration) window.setInterval(() => void registration.update().catch(() => {}), HOURLY);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
