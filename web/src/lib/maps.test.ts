import { compass, directionsUrl, distanceM, embedUrl, formatCoords, mapsUrl } from './maps';
import { findDuplicateName, nameKey } from '../api/drivers';
import { validateDriverName } from '../pages/RegisterDriverPage';

const MAKATI = { lat: 14.5547, lng: 121.0244 };

describe('Google Maps links', () => {
  test('embed, open and directions URLs carry the exact point', () => {
    expect(embedUrl(MAKATI)).toBe('https://maps.google.com/maps?q=14.554700,121.024400&z=16&output=embed');
    expect(mapsUrl(MAKATI)).toContain('query=14.554700,121.024400');
    expect(directionsUrl(MAKATI)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=14.554700,121.024400&travelmode=driving',
    );
  });

  test('compass names headings, including wrap-around', () => {
    expect(compass(0)).toBe('N');
    expect(compass(44)).toBe('NE');
    expect(compass(181)).toBe('S');
    expect(compass(350)).toBe('N');
    expect(compass(-90)).toBe('W');
    expect(compass(undefined)).toBeNull();
  });

  test('distance and coordinate formatting', () => {
    // 0.001° latitude ≈ 111 m
    expect(distanceM(MAKATI, { lat: 14.5557, lng: 121.0244 })).toBeCloseTo(111, 0);
    expect(formatCoords({ lat: -33.85, lng: -151.2 })).toBe('33.85000° S, 151.20000° W');
  });
});

describe('driver names (twins)', () => {
  const existing = [{ name: 'Juan Dela Cruz' }];

  test('nameKey matches the backend normalisation', () => {
    expect(nameKey('  Juan   DELA\tCruz ')).toBe('juan dela cruz');
    expect(findDuplicateName('juan dela  cruz', existing)).toBe('Juan Dela Cruz');
    expect(findDuplicateName('Juan Dela Cruz Jr.', existing)).toBeNull();
  });

  test('validateDriverName explains how to tell twins apart', () => {
    expect(validateDriverName('', existing)).toBe('Enter the driver’s name');
    expect(validateDriverName('', existing, true)).toBe('');
    expect(validateDriverName('J', existing)).toMatch(/at least 2/);
    expect(validateDriverName('123', existing)).toMatch(/letters/);
    expect(validateDriverName('JUAN DELA CRUZ', existing)).toMatch(/already registered.*Twins/);
    expect(validateDriverName('Jose Dela Cruz', existing)).toBe('');
  });
});
