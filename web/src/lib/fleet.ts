import type { Driver, DriverLiveStatus, DriverStatus, GeoLocation } from '../api/types';

/** No reading for this long → offline (same rule as the driver cards). */
export const ONLINE_MS = 30_000;

export interface FleetEntry {
  driver: Driver;
  status: DriverStatus;
  lastUpdate: string | null;
  location: GeoLocation | null;
}

/** Every driver with their current status (live socket data first, then the last API snapshot). */
export function fleet(drivers: Driver[], live: Record<string, DriverLiveStatus>, now = Date.now()): FleetEntry[] {
  return drivers.map((driver) => {
    const l = live[driver.id];
    const lastUpdate = l?.lastUpdate ?? driver.lastUpdate ?? null;
    const online = Boolean(lastUpdate && now - new Date(lastUpdate).getTime() <= ONLINE_MS);
    return {
      driver,
      status: online ? (l?.status ?? driver.status) : 'offline',
      lastUpdate,
      location: l?.location ?? driver.lastLocation ?? null,
    };
  });
}

const URGENCY: Record<DriverStatus, number> = { drowsy: 0, warning: 1, alert: 2, offline: 3 };

/** Drivers who need the parent right now (several can at once), most urgent first. */
export function needsAttention(entries: FleetEntry[]): FleetEntry[] {
  return entries
    .filter((e) => e.status === 'drowsy' || e.status === 'warning')
    .sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || a.driver.name.localeCompare(b.driver.name));
}

/** Drivers that can be put on the map (driving now, or with a last known position). */
export function mappable(entries: FleetEntry[]): (FleetEntry & { location: GeoLocation })[] {
  return entries.filter((e): e is FleetEntry & { location: GeoLocation } => Boolean(e.location));
}
