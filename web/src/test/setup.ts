import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node 25+ ships its own (disabled) Web Storage global that shadows jsdom's — use jsdom's.
const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom lacks these browser APIs used by framer-motion / layout.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.IntersectionObserver =
  window.IntersectionObserver ?? (IO as unknown as typeof IntersectionObserver);
