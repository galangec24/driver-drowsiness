import type { GeoLocation } from '../api/types';
import { compass, distanceM } from './maps';

type Point = Pick<GeoLocation, 'lat' | 'lng'>;

/** Free vector map with 3D building heights (OpenStreetMap data, no API key, no billing). */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** "850 m" / "12.4 km". */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** Initial compass bearing (0-360°) from `a` to `b`. */
export function bearingDeg(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (((Math.atan2(y, x) / rad) % 360) + 360) % 360;
}

/** "3.2 km NE of you". */
export function distanceLabel(you: Point, driver: Point): string {
  return `${formatDistance(distanceM(you, driver))} ${compass(bearingDeg(you, driver)) ?? ''} of you`.replace(
    /\s+/g,
    ' ',
  );
}

/** GeoJSON line from the parent to the driver (drawn on the map). */
export function lineBetween(a: Point, b: Point) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: [
        [a.lng, a.lat],
        [b.lng, b.lat],
      ],
    },
  };
}

/** WebGL is required for the 3D map; older devices get the flat Google map instead. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
