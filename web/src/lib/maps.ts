import type { GeoLocation } from '../api/types';

/**
 * Google Maps without a JavaScript API key:
 * - the embeddable map uses the public `output=embed` endpoint, or the official Maps Embed API
 *   when VITE_GOOGLE_MAPS_EMBED_KEY is set (a browser key restricted by HTTP referrer — public by
 *   design, not a secret);
 * - "Open in Google Maps" / "Directions" use Maps URLs, which open the Maps app on phones.
 */
const EMBED_KEY = (import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY as string | undefined)?.trim();

const point = (l: Pick<GeoLocation, 'lat' | 'lng'>) => `${l.lat.toFixed(6)},${l.lng.toFixed(6)}`;

export function embedUrl(l: Pick<GeoLocation, 'lat' | 'lng'>, zoom = 16): string {
  if (EMBED_KEY) {
    return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(EMBED_KEY)}&q=${point(l)}&zoom=${zoom}`;
  }
  return `https://maps.google.com/maps?q=${point(l)}&z=${zoom}&output=embed`;
}

export function mapsUrl(l: Pick<GeoLocation, 'lat' | 'lng'>): string {
  return `https://www.google.com/maps/search/?api=1&query=${point(l)}`;
}

/** Turn-by-turn from wherever the parent is now to the driver's position. */
export function directionsUrl(l: Pick<GeoLocation, 'lat' | 'lng'>): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${point(l)}&travelmode=driving`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** 0–360° course → "NE" etc. */
export function compass(heading: number | undefined | null): string | null {
  if (heading === undefined || heading === null || !Number.isFinite(heading)) return null;
  return COMPASS[Math.round((((heading % 360) + 360) % 360) / 45) % 8]!;
}

/** Great-circle distance in metres. */
export function distanceM(a: Pick<GeoLocation, 'lat' | 'lng'>, b: Pick<GeoLocation, 'lat' | 'lng'>): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatCoords(l: Pick<GeoLocation, 'lat' | 'lng'>): string {
  const ns = l.lat >= 0 ? 'N' : 'S';
  const ew = l.lng >= 0 ? 'E' : 'W';
  return `${Math.abs(l.lat).toFixed(5)}° ${ns}, ${Math.abs(l.lng).toFixed(5)}° ${ew}`;
}
