import { useState, type ReactNode } from 'react';
import type { Alert } from '../../api/types';
import { formatTime, tripText } from '../../lib/format';
import { distanceM, formatCoords, mapsUrl } from '../../lib/maps';
import { formatDistance } from '../../lib/map3d';
import { Icon } from '../ui/Icon';

type Point = { lat: number; lng: number };

function Place({ label, point, children }: { label: string; point?: Point | null; children?: ReactNode }) {
  return (
    <div className="glass-inset flex flex-col gap-0.5 px-3 py-2 text-sm">
      <span className="text-xs text-ink-muted">{label}</span>
      {point ? (
        <a
          href={mapsUrl(point)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-white hover:underline"
        >
          <Icon name="pin" size={14} /> {formatCoords(point)}
        </a>
      ) : (
        <span className="text-ink-muted">Not recorded</span>
      )}
      {children}
    </div>
  );
}

/**
 * The three places that matter for an alert: where the drive started (the driver was first
 * detected), where the driver was when the alert fired, and where the parent is now. The parent's
 * position comes from this device, only when asked, and is never sent to the server.
 */
export function AlertLocations({ alert }: { alert: Alert }) {
  const [you, setYou] = useState<Point | null>(null);
  const [state, setState] = useState<'idle' | 'locating' | 'error'>('idle');
  const start = alert.trip?.startLocation ?? null;
  const driver = alert.location ?? null;

  function locate() {
    if (!navigator.geolocation) {
      setState('error');
      return;
    }
    setState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setYou({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setState('idle');
      },
      () => setState('error'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  return (
    <section className="mt-5" data-testid="alert-locations">
      <h3 className="label mb-2">Locations</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <Place label="Drive started (driver first detected)" point={start}>
          {alert.trip && (
            <span className="text-xs text-ink-muted">{formatTime(alert.trip.startedAt)}</span>
          )}
        </Place>
        <Place label="Driver at the alert" point={driver}>
          {alert.trip && (
            <span className="text-xs text-indigo-100" data-testid="locations-trip">
              {tripText(alert.trip)}
            </span>
          )}
        </Place>
        <Place label="You (parent)" point={you}>
          {you && driver ? (
            <span className="text-xs text-indigo-100" data-testid="locations-you">
              {formatDistance(distanceM(you, driver))} from where the alert happened
            </span>
          ) : (
            <button
              type="button"
              onClick={locate}
              disabled={state === 'locating'}
              className="mt-1 self-start rounded-lg bg-white/10 px-2 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-50"
            >
              {state === 'locating' ? 'Finding you…' : 'Show my location'}
            </button>
          )}
          {state === 'error' && (
            <span className="text-xs text-amber-300">Allow location access to see how far you are.</span>
          )}
        </Place>
      </div>
    </section>
  );
}
