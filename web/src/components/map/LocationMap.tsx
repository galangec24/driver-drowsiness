import { useEffect, useState } from 'react';
import type { GeoLocation } from '../../api/types';
import { compass, directionsUrl, distanceM, embedUrl, formatCoords, mapsUrl } from '../../lib/maps';
import { timeAgo } from '../../lib/format';
import { useNow } from '../../hooks/useNow';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

export interface LocationMapProps {
  location: GeoLocation | null | undefined;
  /** "live" re-centres as the car moves; "event" is a fixed point (where an alert happened). */
  mode?: 'live' | 'event';
  height?: number;
  title?: string;
}

// Re-centring reloads the embedded map, so only do it after the car has moved this far.
const RECENTER_M = 75;

/** Google map of the driver's position + heading/speed + Open / Directions links. */
export function LocationMap({ location, mode = 'live', height = 260, title }: LocationMapProps) {
  const now = useNow(5000);
  const [shown, setShown] = useState(location ?? null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!location) return;
    setShown((prev) => (!prev || distanceM(prev, location) >= RECENTER_M ? location : prev));
  }, [location]);

  const src = shown ? embedUrl(shown) : null;
  useEffect(() => setLoaded(false), [src]);

  if (!location || !shown) {
    return (
      <div data-testid="location-empty" className="glass-inset flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-ink-muted">
        <Icon name="pin" size={28} className="text-ink-muted" />
        <p>No location yet.</p>
        <p className="text-xs">
          The in-car device sends GPS with each reading (driver monitor: <code>GPS_SOURCE</code>).
        </p>
      </div>
    );
  }

  const dir = compass(location.heading);
  const stale = mode === 'live' && location.at && now - new Date(location.at).getTime() > 60000;

  return (
    <div data-testid="location-map" className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl border border-white/10 shadow-depth-2" style={{ height }}>
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-accent-glow">
            <Spinner size={28} />
          </div>
        )}
        <iframe
          key={src}
          title={title ?? 'Driver location on Google Maps'}
          src={src!}
          className="h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => setLoaded(true)}
        />
        {mode === 'live' && !stale && (
          <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-ok" /> Live
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1 font-medium text-white">
          <Icon name="pin" size={14} /> {formatCoords(location)}
        </span>
        {dir && (
          <span className="inline-flex items-center gap-1" title={`Heading ${Math.round(location.heading!)}°`}>
            <span
              aria-hidden="true"
              className="inline-block text-accent-glow transition-transform duration-500"
              style={{ transform: `rotate(${location.heading}deg)` }}
            >
              <Icon name="navigation" size={14} />
            </span>
            Heading {dir}
          </span>
        )}
        {typeof location.speed === 'number' && <span>{Math.round(location.speed)} km/h</span>}
        {typeof location.accuracy === 'number' && <span>±{Math.round(location.accuracy)} m</span>}
        {location.at && <span className={stale ? 'text-amber-300' : ''}>{mode === 'live' ? 'Updated' : 'Recorded'} {timeAgo(location.at, now)}</span>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={directionsUrl(location)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-gradient-to-b from-accent-glow to-accent-primary text-sm font-semibold text-white shadow-depth-1 transition-all hover:shadow-glow active:translate-y-px"
        >
          <Icon name="directions" size={16} /> Directions
        </a>
        <a
          href={mapsUrl(location)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-glass-border bg-glass-light text-sm font-semibold text-slate-100 shadow-depth-1 transition-all hover:bg-glass-hover active:translate-y-px"
        >
          <Icon name="map" size={16} /> Google Maps
        </a>
      </div>
    </div>
  );
}
