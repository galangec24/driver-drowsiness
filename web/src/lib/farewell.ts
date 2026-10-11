/**
 * "Thanks for using Guardian Drive": set when the user signs out on purpose, shown once by the
 * login page. A session that simply expired (401) does not set it.
 */
const KEY = 'gd:farewell';

export function markFarewell(name: string | undefined): void {
  try {
    sessionStorage.setItem(KEY, (name ?? '').trim().split(/\s+/)[0] ?? '');
  } catch {
    // private mode: no farewell card, nothing else breaks
  }
}

/** The first name to thank (may be ''), or null when the user didn't just sign out. Read once. */
export function takeFarewell(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}
