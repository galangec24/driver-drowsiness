import { bearingDeg, distanceLabel, formatDistance, lineBetween } from './map3d';
import { locationFromParams } from '../pages/EmbedMapPage';

describe('3D map helpers', () => {
  test('distances read naturally', () => {
    expect(formatDistance(4)).toBe('10 m');
    expect(formatDistance(847)).toBe('850 m');
    expect(formatDistance(3240)).toBe('3.2 km');
    expect(formatDistance(48_600)).toBe('49 km');
  });

  test('bearing and the "km NE of you" label', () => {
    const manila = { lat: 14.5995, lng: 120.9842 };
    expect(bearingDeg(manila, { lat: 15.5995, lng: 120.9842 })).toBeCloseTo(0, 0); // due north
    expect(bearingDeg(manila, { lat: 14.5995, lng: 121.9842 })).toBeCloseTo(90, 0); // due east
    expect(distanceLabel(manila, { lat: 14.62, lng: 121.005 })).toMatch(/^3\.\d km NE of you$/);
  });

  test('line from the parent to the driver is lng/lat GeoJSON', () => {
    expect(lineBetween({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }).geometry.coordinates).toEqual([
      [2, 1],
      [4, 3],
    ]);
  });

  test('embed map page parses only valid coordinates', () => {
    expect(locationFromParams(new URLSearchParams('lat=14.5&lng=121&heading=45'))).toEqual({
      lat: 14.5,
      lng: 121,
      heading: 45,
    });
    expect(locationFromParams(new URLSearchParams('lat=14.5'))).toBeNull();
    expect(locationFromParams(new URLSearchParams('lat=99&lng=121'))).toBeNull();
    expect(locationFromParams(new URLSearchParams('lat=abc&lng=121'))).toBeNull();
  });
});
