import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Driver, DriverLiveStatus } from '../api/types';
import { fleet, mappable, needsAttention } from './fleet';
import { copyrightYears } from './brand';
import { AttentionPanel } from '../components/dashboard/AttentionPanel';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

function driver(id: string, name: string, extra: Partial<Driver> = {}): Driver {
  return {
    id,
    parentId: 'p1',
    name,
    relationship: 'child',
    referencePhotoUrl: '',
    personalThresholds: {} as Driver['personalThresholds'],
    faceEnrolled: true,
    createdAt: ago(9999),
    status: 'offline',
    lastUpdate: null,
    ...extra,
  };
}

describe('several drivers at the same time', () => {
  const drivers = [driver('a', 'Ana'), driver('b', 'Ben'), driver('c', 'Cara'), driver('d', 'Dan')];
  const live: Record<string, DriverLiveStatus> = {
    a: { driverId: 'a', status: 'warning', lastUpdate: ago(2), location: { lat: 14.5, lng: 121 } },
    b: { driverId: 'b', status: 'drowsy', lastUpdate: ago(1), location: { lat: 14.6, lng: 121.1 } },
    c: { driverId: 'c', status: 'alert', lastUpdate: ago(3) },
    d: { driverId: 'd', status: 'drowsy', lastUpdate: ago(120) }, // stale: offline
  };

  test('everyone in trouble is listed, most urgent first; stale drivers count as offline', () => {
    const entries = fleet(drivers, live, NOW);
    expect(entries.find((e) => e.driver.id === 'd')!.status).toBe('offline');
    expect(needsAttention(entries).map((e) => [e.driver.name, e.status])).toEqual([
      ['Ben', 'drowsy'],
      ['Ana', 'warning'],
    ]);
    expect(mappable(entries).map((e) => e.driver.name)).toEqual(['Ana', 'Ben']);
  });

  test('the dashboard panel shows each of them', () => {
    render(
      <MemoryRouter>
        <AttentionPanel entries={needsAttention(fleet(drivers, live, NOW))} />
      </MemoryRouter>,
    );
    const panel = screen.getByTestId('attention-panel');
    expect(panel).toHaveTextContent('2 drivers need attention');
    expect(panel).toHaveTextContent('Ben');
    expect(panel).toHaveTextContent('Ana');
    expect(screen.getAllByRole('link', { name: /directions/i })).toHaveLength(2);
  });
});

test('copyright years update by themselves', () => {
  expect(copyrightYears(new Date('2026-06-01'))).toBe('2026');
  expect(copyrightYears(new Date('2028-01-01'))).toBe('2026–2028');
});
