export type Platform = "android" | "ios" | "desktop";

/** Which install path to recommend first. */
export function detectPlatform(
  ua: string = navigator.userAgent,
  maxTouchPoints = navigator.maxTouchPoints,
): Platform {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  if (/macintosh/i.test(ua) && maxTouchPoints > 1) return "ios";
  return "desktop";
}

/** Running as an installed app (home-screen / desktop window) rather than in a browser tab. */
export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
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
  loc: Pick<
    Location,
    "protocol" | "hostname" | "port" | "origin"
  > = window.location,
  lanHost: string = __LAN_HOST__,
): string {
  const local =
    loc.hostname === "localhost" ||
    loc.hostname === "127.0.0.1" ||
    loc.hostname === "[::1]";
  if (!local || !lanHost) return loc.origin;
  return `${loc.protocol}//${lanHost}${loc.port ? `:${loc.port}` : ""}`;
}

export interface ApkInfo {
  available: boolean;
  sizeBytes?: number;
  updatedAt?: string;
}

/**
 * Size and date of the hosted APK (HEAD /app.apk). A missing file is reported as unavailable,
 * including dev servers that answer unknown paths with the HTML app shell.
 */
export async function fetchApkInfo(url = "/app.apk"): Promise<ApkInfo> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || type.includes("text/html")) return { available: false };
    const size = Number(res.headers.get("content-length"));
    const modified = res.headers.get("last-modified");
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
