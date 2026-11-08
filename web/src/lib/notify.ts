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
      notificationsSupported() && Notification.permission === 'granted' && localStorage.getItem(PREF_KEY) !== 'off'
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

/** Asks the app (AppShell) to open an alert's details: a clicked notification. */
export const OPEN_ALERT_EVENT = 'gd:open-alert';

export function openAlert(alertId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_ALERT_EVENT, { detail: alertId }));
}

/** `tag` is the alert id: clicking the notification brings the app forward and opens that alert. */
export function notifyBrowser(title: string, body: string, tag: string): void {
  if (!notificationsEnabled() || document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/icons/icon-192.png' });
    n.onclick = () => {
      window.focus();
      // The Windows app: restore and raise its window (minimised or behind other windows).
      void window.guardianDesktop?.focusWindow?.();
      n.close();
      openAlert(tag);
    };
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
