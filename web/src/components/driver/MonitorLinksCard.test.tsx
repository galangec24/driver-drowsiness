import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { MonitorLinksCard } from './MonitorLinksCard';
import { MonitorPage } from '../../pages/MonitorPage';
import { renderWithProviders } from '../../test/utils';
import * as monitorApi from '../../api/monitor';

vi.mock('../../api/monitor', async (orig) => ({
  ...(await orig<typeof import('../../api/monitor')>()),
  createMonitorLink: vi.fn(),
  listMonitorLinks: vi.fn(),
  revokeMonitorLink: vi.fn(),
}));

const link = {
  id: 'l1',
  driverId: 'd1',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7 * 86400e3).toISOString(),
  lastUsedAt: null,
  status: 'active' as const,
};

describe('monitor links (testing phase)', () => {
  test('create shows the link and QR once; active links can be revoked', async () => {
    vi.mocked(monitorApi.listMonitorLinks).mockResolvedValue([link]);
    vi.mocked(monitorApi.createMonitorLink).mockResolvedValue({ link, token: 'secret-token-123456' });
    vi.mocked(monitorApi.revokeMonitorLink).mockResolvedValue({ ...link, status: 'revoked' });
    renderWithProviders(<MonitorLinksCard driverId="d1" driverName="Galang" />);
    await userEvent.click(screen.getByRole('button', { name: /create monitor link/i }));
    const box = await screen.findByTestId('monitor-link-new');
    expect(box).toHaveTextContent('/monitor/secret-token-123456');
    expect(box.querySelector('svg')).not.toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(vi.mocked(monitorApi.revokeMonitorLink).mock.calls[0]?.[0]).toBe('l1'));
  });

  test('a revoked link shows why, and nothing else', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'This monitor link was revoked' }), { status: 401 }),
    );
    renderWithProviders(
      <Routes>
        <Route path="/monitor/:token" element={<MonitorPage />} />
      </Routes>,
      { route: '/monitor/abcdefabcdefabcdef' },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/revoked\. Ask the parent for a new link/);
    expect(screen.queryByRole('button', { name: /start monitoring/i })).not.toBeInTheDocument();
  });
});
