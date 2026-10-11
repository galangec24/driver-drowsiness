import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { UpdatesCard } from './UpdatesCard';

afterEach(() => {
  delete window.guardianDesktop;
});

describe('UpdatesCard', () => {
  test('in the Windows app: shows its version and checks for an update', async () => {
    const checkForUpdates = vi
      .fn()
      .mockResolvedValueOnce({ status: 'downloading', version: '1.0.6' })
      .mockResolvedValueOnce({ status: 'ready', version: '1.0.6' });
    const installUpdate = vi.fn(async () => ({ status: 'ready' as const, version: '1.0.6' }));
    window.guardianDesktop = {
      openExternal: vi.fn(async () => {}),
      appInfo: vi.fn(async () => ({ version: '1.0.5', update: { status: 'idle' as const, version: null } })),
      checkForUpdates,
      installUpdate,
    };
    renderWithProviders(<UpdatesCard />);
    expect(await screen.findByText('1.0.5')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /check for updates/i }));
    expect(await screen.findByText(/Version 1.0.6: Downloading the update/)).toBeInTheDocument();
    // still downloading: no second check until it is done
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeDisabled();
  });

  test('an update that is ready can be installed with one click', async () => {
    const installUpdate = vi.fn(async () => ({ status: 'ready' as const, version: '1.0.6' }));
    window.guardianDesktop = {
      openExternal: vi.fn(async () => {}),
      appInfo: vi.fn(async () => ({ version: '1.0.5', update: { status: 'ready' as const, version: '1.0.6' } })),
      checkForUpdates: vi.fn(),
      installUpdate,
    };
    renderWithProviders(<UpdatesCard />);
    await userEvent.click(await screen.findByRole('button', { name: /restart and update/i }));
    expect(installUpdate).toHaveBeenCalled();
  });

  test('an old Windows app without the updater is told to reinstall once', () => {
    window.guardianDesktop = { openExternal: vi.fn(async () => {}) };
    renderWithProviders(<UpdatesCard />);
    expect(screen.getByTestId('updates-card')).toHaveTextContent('older version without automatic updates');
  });

  test('on the website: version and a check button', () => {
    renderWithProviders(<UpdatesCard />);
    expect(screen.getByTestId('updates-card')).toHaveTextContent('Website version');
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeEnabled();
  });
});
