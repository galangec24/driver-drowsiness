import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import type { FleetEntry } from '../../lib/fleet';
import { MAP_STYLE_URL, webglAvailable } from '../../lib/map3d';
import { Spinner } from '../ui/Spinner';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

type Located = FleetEntry & { location: NonNullable<FleetEntry['location']> };

function markerEl(e: Located, onOpen: () => void): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `gd-driver-marker gd-status-${e.status}`;
  el.title = `${e.driver.name}: ${e.status === 'offline' ? 'last known position' : e.status}`;
  el.innerHTML = `${e.status === 'drowsy' || e.status === 'warning' ? '<span class="gd-pulse"></span>' : ''}<span class="gd-dot"></span><span class="gd-label"></span>`;
  el.querySelector('.gd-label')!.textContent = e.driver.name;
  el.addEventListener('click', onOpen);
  return el;
}

/** All drivers on one 3D map, coloured by status: several cars at the same time at a glance. */
export function FleetMap({ entries, height = 340 }: { entries: Located[]; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef<Marker[]>([]);
  const fitted = useRef(false);
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(() => !webglAvailable());

  useEffect(() => {
    if (failed) return undefined;
    let cancelled = false;
    let created: MlMap | null = null;
    (async () => {
      try {
        const [ml] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
        if (cancelled || !host.current) return;
        lib.current = ml;
        ml.setWorkerUrl(workerUrl);
        const first = entries[0]?.location;
        created = new ml.Map({
          container: host.current,
          style: MAP_STYLE_URL,
          center: first ? [first.lng, first.lat] : [121.0, 14.6],
          zoom: 12,
          pitch: 45,
          attributionControl: { compact: true },
        });
        map.current = created;
        created.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
        created.on('load', () => !cancelled && setReady(true));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      created?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once
  }, [failed]);

  // Markers follow the live data; the view fits everyone the first time.
  useEffect(() => {
    const m = map.current;
    const ml = lib.current;
    if (!ready || !m || !ml) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = entries.map((e) =>
      new ml.Marker({ element: markerEl(e, () => navigate(`/drivers/${e.driver.id}`)) })
        .setLngLat([e.location.lng, e.location.lat])
        .addTo(m),
    );
    if (!fitted.current && entries.length) {
      fitted.current = true;
      if (entries.length === 1) {
        m.jumpTo({ center: [entries[0]!.location.lng, entries[0]!.location.lat], zoom: 15 });
      } else {
        const b = new ml.LngLatBounds();
        entries.forEach((e) => b.extend([e.location.lng, e.location.lat]));
        m.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
      }
    }
  }, [ready, entries, navigate]);

  if (failed) return null;
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-white/10 shadow-depth-2"
      style={{ height }}
      data-testid="fleet-map"
    >
      <div ref={host} className="h-full w-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-accent-glow">
          <Spinner size={28} />
        </div>
      )}
    </div>
  );
}
