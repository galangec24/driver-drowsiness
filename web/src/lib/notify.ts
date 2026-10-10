/**
 * Browser notifications for alerts while the tab is hidden. FCM Web Push is enabled
 * server-side via /api/push/config; until then this covers open-but-backgrounded tabs.
 */
const PREF_KEY = 'gd:notify';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationsEnabled(): boolean {
  try {
    return (
      notificationsSupported() &&
      Notification.permission === 'granted' &&
      localStorage.getItem(PREF_KEY) !== 'off'
    );
  } catch {
    return false;
  }
}

export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const result = await Notification.requestPermission();
  try {
    localStorage.setItem(PREF_KEY, result === 'granted' ? 'on' : 'off');
  } catch {
    // ignore
  }
  return result === 'granted';
}

export function disableNotifications(): void {
  try {
    localStorage.setItem(PREF_KEY, 'off');
  } catch {
    // ignore
  }
}

export function notifyBrowser(title: string, body: string, tag: string): void {
  if (!notificationsEnabled() || document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/icons/icon-192.png' });
    n.onclick = () => {
      window.focus();
      window.location.assign('/alerts');
    };
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
