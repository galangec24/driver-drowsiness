import { useEffect, useState } from 'react';

/** Light / dark theme. "system" follows the device setting. Saved on this device only. */
export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'gd:theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemTheme = (): Theme =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

export const resolveTheme = (pref: ThemePref): Theme => (pref === 'system' ? systemTheme() : pref);

export function applyTheme(pref: ThemePref): Theme {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f4f6fb' : '#070914');
  return theme;
}

export function setThemePref(pref: ThemePref): Theme {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
  const theme = applyTheme(pref);
  window.dispatchEvent(new CustomEvent('gd:theme', { detail: pref }));
  return theme;
}

/** Current preference + resolved theme; re-renders on changes (any tab component, or the OS). */
export function useTheme(): { pref: ThemePref; theme: Theme; setPref: (p: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>(getThemePref);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(getThemePref()));
  useEffect(() => {
    const onChange = () => {
      const p = getThemePref();
      setPrefState(p);
      setTheme(applyTheme(p));
    };
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    window.addEventListener('gd:theme', onChange);
    mq?.addEventListener?.('change', onChange);
    return () => {
      window.removeEventListener('gd:theme', onChange);
      mq?.removeEventListener?.('change', onChange);
    };
  }, []);
  return { pref, theme, setPref: (p) => setThemePref(p) };
}
