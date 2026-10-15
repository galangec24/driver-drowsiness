import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import type { GeoLocation } from '../../api/types';
import { MAP_STYLE_URL, distanceLabel, lineBetween } from '../../lib/map3d';
import { distanceM } from '../../lib/maps';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
// The map's background worker (self-contained file). Passing its URL explicitly makes it load in
// both the dev server and the production build (MapLibre's own guess breaks after bundling).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

export interface Map3DProps {
  location: GeoLocation;
  height: number;
  /** Shown on the driver's marker. */
  label?: string;
  /** "live": follows the car; "event": where an alert happened. */
  mode?: 'live' | 'event';
  /** Offer "Show my distance" (browser location). Off inside the Android app's map view. */
  allowMyLocation?: boolean;
  /** The 3D map could not start (no WebGL, tiles blocked): show the flat map instead. */
  onFail: () => void;
}

const PITCH_3D = 60;
// No map after this long (blocked tiles, very slow GPU): switch to the flat Google map.
const LOAD_TIMEOUT_MS = 20_000;
const ROUTE_SOURCE = 'parent-to-driver';

function driverMarkerEl(label: string | undefined, heading: number | undefined): HTMLElement {
  const el = document.createElement('div');
  el.className = 'gd-driver-marker';
  el.innerHTML = `
    <span class="gd-pulse"></span>
    <span class="gd-dot">${typeof heading === 'number' ? `<span class="gd-arrow" style="transform: rotate(${heading}deg)">▲</span>` : ''}</span>
    ${label ? `<span class="gd-label"></span>` : ''}`;
  if (label) el.querySelector('.gd-label')!.textContent = label;
  return el;
}

function youMarkerEl(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'gd-you-marker';
  el.innerHTML = '<span class="gd-dot"></span><span class="gd-label">You</span>';
  return el;
}

/**
 * 3D map of the driver (MapLibre + OpenStreetMap tiles with building heights): tilted view,
 * heading arrow, and on request the parent's own position, the line between them and the distance.
 */
export function Map3D({ location, height, label, mode = 'live', allowMyLocation = true, onFail }: Map3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const driverMarker = useRef<Marker | null>(null);
  const youMarker = useRef<Marker | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const [ready, setReady] = useState(false);
  const [tilted, setTilted] = useState(true);
  const [you, setYou] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  const failRef = useRef(onFail);
  failRef.current = onFail;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let created: MlMap | null = null;
    let loaded = false;
    const timer = window.setTimeout(() => {
      if (!loaded && !cancelled) failRef.current();
    }, LOAD_TIMEOUT_MS);
    (async () => {
      try {
        const [ml] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
        if (cancelled || !host.current) return;
        lib.current = ml;
        ml.setWorkerUrl(workerUrl);
        created = new ml.Map({
          container: host.current,
          style: MAP_STYLE_URL,
          center: [location.lng, location.lat],
          zoom: 16.5,
          pitch: PITCH_3D,
          bearing: typeof location.heading === 'number' ? location.heading : -20,
          attributionControl: { compact: true },
          canvasContextAttributes: { antialias: true },
        });
        map.current = created;
        created.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
        created.on('error', (e) => {
          // A missing tile is fine; a style that never loads means the map can't work here.
          if (!created?.isStyleLoaded() && /style/i.test(String(e?.error?.message ?? ''))) failRef.current();
        });
        created.on('load', () => {
          loaded = true;
          if (cancelled) return;
          driverMarker.current = new ml.Marker({ element: driverMarkerEl(label, location.heading ?? undefined) })
            .setLngLat([location.lng, location.lat])
            .addTo(created!);
          created!.addSource(ROUTE_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          created!.addLayer({
            id: ROUTE_SOURCE,
            type: 'line',
            source: ROUTE_SOURCE,
            paint: { 'line-color': '#818cf8', 'line-width': 4, 'line-dasharray': [2, 1.5], 'line-opacity': 0.9 },
          });
          setReady(true);
        });
      } catch {
        if (!cancelled) failRef.current();
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      created?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; updates below
  }, []);

  // Follow the car.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !lib.current) return;
    driverMarker.current?.remove();
    driverMarker.current = new lib.current.Marker({ element: driverMarkerEl(label, location.heading ?? undefined) })
      .setLngLat([location.lng, location.lat])
      .addTo(m);
    if (you) {
      (m.getSource(ROUTE_SOURCE) as import('maplibre-gl').GeoJSONSource | undefined)?.setData(
        lineBetween(you, location),
      );
    } else if (mode === 'live') {
      const c = m.getCenter();
      if (distanceM({ lat: c.lat, lng: c.lng }, location) > 30) m.easeTo({ center: [location.lng, location.lat] });
    }
  }, [ready, location, label, you, mode]);

  function toggleTilt() {
    const m = map.current;
    if (!m) return;
    const next = !tilted;
    m.easeTo({ pitch: next ? PITCH_3D : 0, duration: 600 });
    setTilted(next);
  }

  function showMyDistance() {
    if (!navigator.geolocation) {
      setLocError('This browser cannot share its location.');
      return;
    }
    setLocating(true);
    setLocError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setYou(here);
        const m = map.current;
        if (!m || !lib.current) return;
        youMarker.current?.remove();
        youMarker.current = new lib.current.Marker({ element: youMarkerEl() }).setLngLat([here.lng, here.lat]).addTo(m);
        (m.getSource(ROUTE_SOURCE) as import('maplibre-gl').GeoJSONSource | undefined)?.setData(
          lineBetween(here, location),
        );
        const bounds = new lib.current.LngLatBounds([here.lng, here.lat], [here.lng, here.lat]).extend([
          location.lng,
          location.lat,
        ]);
        m.fitBounds(bounds, { padding: 70, pitch: tilted ? 45 : 0, maxZoom: 16.5, duration: 900 });
      },
      () => {
        setLocating(false);
        setLocError('Location permission was denied. Allow location for this site to see the distance.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 shadow-depth-2" style={{ height }}>
      {/* h-full, not absolute: MapLibre's CSS makes its container position:relative. */}
      <div ref={host} className="h-full w-full" data-testid="map-3d" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-accent-glow">
          <Spinner size={28} />
        </div>
      )}
      {ready && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-end justify-between gap-2">
          <div className="pointer-events-auto flex gap-2">
            <button
              type="button"
              onClick={toggleTilt}
              className="rounded-lg bg-black/70 px-3 py-1.5 text-xs font-bold text-white backdrop-blur hover:bg-black/85"
              aria-pressed={tilted}
            >
              {tilted ? '2D' : '3D'}
            </button>
            {allowMyLocation && !you && (
              <button
                type="button"
                onClick={showMyDistance}
                disabled={locating}
                className="inline-flex items-center gap-1.5 rounded-lg bg-black/70 px-3 py-1.5 text-xs font-bold text-white backdrop-blur hover:bg-black/85 disabled:opacity-60"
              >
                {locating ? <Spinner size={12} /> : <Icon name="pin" size={12} />} Show my distance
              </button>
            )}
          </div>
        </div>
      )}
      {you && (
        <span
          data-testid="map-distance"
          className="pointer-events-none absolute left-2 top-2 max-w-[70%] rounded-lg bg-accent-primary/90 px-3 py-1.5 text-xs font-bold text-white shadow-glow"
        >
          {label ?? 'Driver'} is {distanceLabel(you, location)} (straight line)
        </span>
      )}
      {locError && (
        <p className="absolute inset-x-2 top-12 rounded-lg bg-black/75 px-3 py-1.5 text-xs text-amber-200">
          {locError}
        </p>
      )}
    </div>
  );
}
