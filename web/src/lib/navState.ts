import { useEffect, useState } from 'react';

/** Side menu collapsed to icons on large screens (the ☰ toggle). Saved on this device. */
const KEY = 'gd:navCollapsed';
const EVENT = 'gd:navCollapsed';

export function getNavCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setNavCollapsed(v: boolean): void {
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    // storage blocked: lasts for this visit
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: v }));
}

export function useNavCollapsed(): [boolean, (v: boolean) => void] {
  const [collapsed, set] = useState(getNavCollapsed);
  useEffect(() => {
    const on = (e: Event) => set(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [collapsed, setNavCollapsed];
}
