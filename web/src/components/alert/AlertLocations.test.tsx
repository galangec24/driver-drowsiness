import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Alert } from '../../api/types';
import { AlertLocations } from './AlertLocations';

const alert = {
  id: 'a1',
  driverId: 'd1',
  parentId: 'p1',
  type: 'microsleep',
  confidence: 0.9,
  sensorSnapshot: {},
  acknowledged: false,
  createdAt: '2026-11-08T10:30:00.000Z',
  location: { lat: 14.55, lng: 121.0, at: '2026-11-08T10:30:00.000Z' },
  trip: {
    startedAt: '2026-11-08T10:05:00.000Z',
    distanceKm: 12.4,
    minutes: 25,
    startLocation: { lat: 14.45, lng: 121.0 },
  },
} as unknown as Alert;

describe('AlertLocations', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('shows where the drive started, where the alert happened and how far was driven', () => {
    render(<AlertLocations alert={alert} />);
    expect(screen.getByText(/14.45000° N/)).toBeInTheDocument();
    expect(screen.getByTestId('locations-trip')).toHaveTextContent('12.4 km and 25 min after the drive started');
  });

  test("the parent's own location is read from this device only when asked", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: 14.56, longitude: 121.0 } } as GeolocationPosition),
    );
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
    render(<AlertLocations alert={alert} />);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /show my location/i }));
    expect(screen.getByTestId('locations-you')).toHaveTextContent(/1\.1 km from where the alert happened/);
  });
});
