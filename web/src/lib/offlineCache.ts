import { isNetworkError } from '../api/client';

/**
 * Tiny last-known-good cache so the PWA can show drivers/alerts offline with a
 * "Last updated" timestamp. Holds only non-secret data the parent already sees.
 */
const PREFIX = 'gd:cache:';

interface Entry<T> {
  data: T;
  savedAt: string;
}

export function saveSnapshot<T>(key: string, data: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: new Date().toISOString() }));
  } catch {
    // Storage full or blocked — offline cache is best-effort.
  }
}

export function readSnapshot<T>(key: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Entry<T>) : null;
  } catch {
    return null;
  }
}

export function clearSnapshots(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

/** Run a fetcher; on success snapshot it, on network failure fall back to the snapshot. */
export async function withOfflineFallback<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const data = await fetcher();
    saveSnapshot(key, data);
    return data;
  } catch (err) {
    const cached = isNetworkError(err) ? readSnapshot<T>(key) : null;
    if (cached) return cached.data;
    throw err;
  }
}
