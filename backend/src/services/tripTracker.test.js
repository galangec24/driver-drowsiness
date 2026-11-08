const tripTracker = require('./tripTracker');

const MIN = 60_000;
// ~1.1 km per 0.01° of latitude.
const at = (lat, extra = {}) => ({ lat, lng: 121.0, speed: 50, accuracy: 10, ...extra });

describe('tripTracker', () => {
  beforeEach(() => tripTracker.clear());

  test('distance and time from the start of the drive to the first alert; later alerts get none', async () => {
    const t0 = 1_000_000_000;
    tripTracker.update('d1', t0, at(14.5)); // first seen: the drive starts
    tripTracker.update('d1', t0 + 1 * MIN, at(14.51));
    tripTracker.update('d1', t0 + 2 * MIN, null); // no GPS this reading
    tripTracker.update('d1', t0 + 3 * MIN, at(14.52));
    const trip = await tripTracker.firstAlert('d1', t0 + 3 * MIN);
    expect(trip.distanceKm).toBeCloseTo(2.2, 1);
    expect(trip.minutes).toBe(3);
    expect(trip.startedAt).toEqual(new Date(t0));
    expect(trip.startLocation).toEqual({ lat: 14.5, lng: 121.0 });
    expect(await tripTracker.firstAlert('d1', t0 + 4 * MIN)).toBeNull();
  });

  test('a 15-minute break starts a new drive', async () => {
    const t0 = 1_000_000_000;
    tripTracker.update('d1', t0, at(14.5));
    tripTracker.update('d1', t0 + MIN, at(14.6));
    tripTracker.update('d1', t0 + 20 * MIN, at(14.6)); // back after the gas station
    tripTracker.update('d1', t0 + 22 * MIN, at(14.61));
    const trip = await tripTracker.firstAlert('d1', t0 + 22 * MIN);
    expect(trip.minutes).toBe(2);
    expect(trip.distanceKm).toBeCloseTo(1.1, 1);
  });

  test('GPS noise is ignored: bad accuracy, impossible jumps and jitter while parked', async () => {
    const t0 = 1_000_000_000;
    tripTracker.update('d1', t0, at(14.5, { speed: 0 }));
    tripTracker.update('d1', t0 + 1000, at(14.50005, { speed: 0 })); // 5 m jitter, parked
    tripTracker.update('d1', t0 + 2000, at(14.9, { accuracy: 500 })); // poor fix
    tripTracker.update('d1', t0 + 3000, at(15.5)); // 110 km in a second
    const trip = await tripTracker.firstAlert('d1', t0 + 3000);
    expect(trip.distanceKm).toBe(0);
  });

  test('haversine: 0.01° of latitude is about 1.11 km', () => {
    expect(tripTracker.haversineKm({ lat: 14.5, lng: 121 }, { lat: 14.51, lng: 121 })).toBeCloseTo(1.112, 2);
  });
});
