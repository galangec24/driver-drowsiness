/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public backend URL. Not a secret. */
  readonly VITE_API_URL?: string;
  /** Optional Google Maps Embed API browser key (referrer-restricted, public by design). */
  readonly VITE_GOOGLE_MAPS_EMBED_KEY?: string;
  /** Where the Android APK is downloaded from (default /app.apk on this site). */
  readonly VITE_APK_URL?: string;
  readonly VITE_WINDOWS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
/** This machine's LAN IPv4 at build/dev-server start ('' if none). Only used to replace localhost. */
declare const __LAN_HOST__: string;
