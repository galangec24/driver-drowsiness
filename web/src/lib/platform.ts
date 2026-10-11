export type Platform = 'android' | 'ios' | 'desktop';

/** Which install path to recommend first. */
export function detectPlatform(ua: string = navigator.userAgent, maxTouchPoints = navigator.maxTouchPoints): Platform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  if (/macintosh/i.test(ua) && maxTouchPoints > 1) return 'ios';
  return 'desktop';
}

export type DesktopOs = 'windows' | 'mac' | 'linux' | 'other';

/** Which computer: Windows gets the installer (.exe), others install the web app from the browser. */
export function detectDesktopOs(ua: string = navigator.userAgent): DesktopOs {
  if (/windows/i.test(ua)) return 'windows';
  if (/macintosh|mac os x/i.test(ua)) return 'mac';
  if (/linux|x11|cros/i.test(ua)) return 'linux';
  return 'other';
}

/** Running as an installed app (home-screen / desktop window) rather than in a browser tab. */
export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/**
 * Address a phone can open. On localhost (development) a phone can't reach "localhost", so swap in
 * this PC's network address; deployed sites already have a public origin.
 */
export function shareableOrigin(
  loc: Pick<Location, 'protocol' | 'hostname' | 'port' | 'origin'> = window.location,
  lanHost: string = __LAN_HOST__,
): string {
  const local = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1' || loc.hostname === '[::1]';
  if (!local || !lanHost) return loc.origin;
  return `${loc.protocol}//${lanHost}${loc.port ? `:${loc.port}` : ''}`;
}

/**
 * Where the Android APK is downloaded from. Defaults to /app.apk on this site; set VITE_APK_URL
 * (public, not a secret) to host it elsewhere, e.g. a GitHub Release, because Firebase's free plan
 * refuses .apk files.
 */
export const APK_URL: string = (import.meta.env.VITE_APK_URL as string | undefined)?.trim() || '/app.apk';

/** Windows installer (GuardianDrive-Setup.exe, built from guardian-drive/desktop). VITE_WINDOWS_URL. */
export const WINDOWS_URL: string = (import.meta.env.VITE_WINDOWS_URL as string | undefined)?.trim() || '';

export function isExternalUrl(url: string, origin: string = window.location.origin): boolean {
  return /^https?:\/\//i.test(url) && !url.startsWith(origin);
}

export interface ApkInfo {
  available: boolean;
  sizeBytes?: number;
  updatedAt?: string;
  /** Hosted on another site: size/date can't be read (cross-origin), the link is still valid. */
  external?: boolean;
}

/**
 * Size and date of the hosted APK (HEAD /app.apk). A missing file is reported as unavailable,
 * including dev servers that answer unknown paths with the HTML app shell.
 */
export async function fetchApkInfo(url: string = APK_URL): Promise<ApkInfo> {
  if (isExternalUrl(url)) return { available: true, external: true };
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || type.includes('text/html')) return { available: false };
    const size = Number(res.headers.get('content-length'));
    const modified = res.headers.get('last-modified');
    return {
      available: true,
      ...(Number.isFinite(size) && size > 0 && { sizeBytes: size }),
      ...(modified && { updatedAt: new Date(modified).toISOString() }),
    };
  } catch {
    return { available: false };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
