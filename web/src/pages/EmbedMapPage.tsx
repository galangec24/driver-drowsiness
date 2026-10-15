import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GeoLocation } from '../api/types';
import { Map3D } from '../components/map/Map3D';
import { embedUrl } from '../lib/maps';
import { webglAvailable } from '../lib/map3d';

/** Parses ?lat=&lng=&heading= into a location, or null if missing/invalid. */
export function locationFromParams(params: URLSearchParams): GeoLocation | null {
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (!params.get('lat') || !params.get('lng') || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const heading = Number(params.get('heading'));
  return { lat, lng, ...(params.get('heading') && Number.isFinite(heading) && { heading }) };
}

/**
 * Full-screen 3D map for the Android app's map view: /embed/map?lat=..&lng=..&heading=..&name=..
 * Shows only the coordinates it is given (no account data), so it needs no sign-in.
 */
export function EmbedMapPage() {
  const [params] = useSearchParams();
  const location = locationFromParams(params);
  const [flat, setFlat] = useState(() => !webglAvailable());
  const name = params.get('name')?.slice(0, 40) || undefined;
  const mode = params.get('mode') === 'event' ? 'event' : 'live';

  if (!location) {
    return <div className="flex h-dvh items-center justify-center bg-ink-950 text-sm text-ink-muted">No location</div>;
  }
  return (
    <div className="h-dvh w-full bg-ink-950" data-testid="embed-map">
      {flat ? (
        <iframe title="Driver location" src={embedUrl(location)} className="h-full w-full border-0" />
      ) : (
        <Map3D
          location={location}
          height={window.innerHeight}
          label={name}
          mode={mode}
          allowMyLocation={params.get('me') === '1'}
          onFail={() => setFlat(true)}
        />
      )}
    </div>
  );
}
