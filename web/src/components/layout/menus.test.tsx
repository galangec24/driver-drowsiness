import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { AppShell } from './AppShell';
import { AccountMenu } from './AccountMenu';
import { renderWithProviders } from '../../test/utils';
import { DeleteDriverDialog } from '../driver/DeleteDriverDialog';
import { ReadingHistory } from '../driver/ReadingHistory';
import { MessagePanel } from '../driver/MessagePanel';
import * as driversApi from '../../api/drivers';
import * as messagesApi from '../../api/messages';

vi.mock('../../api/alerts', async (orig) => ({
  ...(await orig<typeof import('../../api/alerts')>()),
  listAlerts: vi.fn().mockResolvedValue({ alerts: [], unacknowledged: 0 }),
}));
vi.mock('../../api/drivers', async (orig) => ({
  ...(await orig<typeof import('../../api/drivers')>()),
  requestDeleteCode: vi.fn(),
  deleteDriver: vi.fn(),
  driverHistory: vi.fn(),
}));
vi.mock('../../api/messages', async (orig) => ({
  ...(await orig<typeof import('../../api/messages')>()),
  listMessages: vi.fn().mockResolvedValue([]),
  sendMessage: vi.fn().mockResolvedValue({ message: {}, carOnline: true }),
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gd:token', 't');
  localStorage.setItem(
    'gd:user',
    JSON.stringify({ id: 'p1', name: 'Maria Galang', email: 'maria@example.com', role: 'parent', createdAt: '' }),
  );
});

describe('account menu (Facebook-style)', () => {
  test('profile on top; settings, help & feedback and log out are separate items', async () => {
    renderWithProviders(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('Maria Galang');
    expect(menu).toHaveTextContent('maria@example.com');
    expect(within(menu).getByTestId('menu-feedback')).toHaveAttribute('href', '/feedback');
    expect(within(menu).getByTestId('menu-logout')).toHaveTextContent('Log out');
    // dark mode toggles from the menu
    await userEvent.click(within(menu).getByTestId('menu-dark-mode'));
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
  });

  test('log out signs the parent out', async () => {
    renderWithProviders(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    await userEvent.click(screen.getByTestId('menu-logout'));
    expect(localStorage.getItem('gd:token')).toBeNull();
  });
});

describe('menu toggle', () => {
  test('☰ collapses the side menu to icons and remembers it', async () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<p>Body</p>} />
        </Route>
      </Routes>,
    );
    const rail = screen.getByTestId('side-rail');
    expect(rail).toHaveClass('lg:w-60');
    await userEvent.click(screen.getByTestId('menu-toggle'));
    expect(rail).not.toHaveClass('lg:w-60');
    expect(localStorage.getItem('gd:navCollapsed')).toBe('1');
    await userEvent.click(screen.getByTestId('menu-toggle'));
    expect(rail).toHaveClass('lg:w-60');
  });

  test('phones get a ☰ drawer with every page, help and log out', async () => {
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<p>Body</p>} />
        </Route>
      </Routes>,
    );
    await userEvent.click(screen.getByTestId('drawer-toggle'));
    const drawer = await screen.findByTestId('menu-drawer');
    expect(drawer).toHaveTextContent('Drivers');
    expect(drawer).toHaveTextContent('Help & feedback');
    expect(drawer).toHaveTextContent('Log out');
  });
});

describe('deleting a driver', () => {
  test('needs the code e-mailed to the account', async () => {
    vi.mocked(driversApi.requestDeleteCode).mockResolvedValue({
      method: 'email',
      email: 'maria@example.com',
      sent: true,
      retryAfterS: 60,
    });
    vi.mocked(driversApi.deleteDriver).mockResolvedValue();
    const onDeleted = vi.fn();
    renderWithProviders(
      <DeleteDriverDialog driverId="d1" driverName="Miguel" onClose={() => undefined} onDeleted={onDeleted} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByTestId('code-sent')).toHaveTextContent('maria@example.com');
    const del = screen.getByRole('button', { name: 'Delete for good' });
    expect(del).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Confirmation code'), '12a3456');
    expect(screen.getByLabelText('Confirmation code')).toHaveValue('123456');
    await userEvent.click(del);
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(vi.mocked(driversApi.deleteDriver).mock.calls[0]).toEqual(['d1', { code: '123456' }]);
  });

  test("without e-mail on the server, the driver's name confirms", async () => {
    vi.mocked(driversApi.requestDeleteCode).mockResolvedValue({ method: 'name' });
    vi.mocked(driversApi.deleteDriver).mockResolvedValue();
    renderWithProviders(
      <DeleteDriverDialog driverId="d1" driverName="Miguel" onClose={() => undefined} onDeleted={() => undefined} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await userEvent.type(await screen.findByLabelText('Driver name'), 'Miguel');
    await userEvent.click(screen.getByRole('button', { name: 'Delete for good' }));
    await waitFor(() =>
      expect(vi.mocked(driversApi.deleteDriver).mock.calls.at(-1)).toEqual(['d1', { confirmName: 'Miguel' }]),
    );
  });
});

describe('reading history', () => {
  test('shows the last reading, the km driven and one row per minute', async () => {
    const at = new Date(Date.now() - 5 * 60e3).toISOString();
    vi.mocked(driversApi.driverHistory).mockResolvedValue({
      from: at,
      to: at,
      totalKm: 12.34,
      lastReading: { at, classification: 'warning', fusionScore: 0.5, source: 'driver_monitor', location: null },
      rows: [
        {
          at,
          from: at,
          readings: 58,
          classification: 'warning',
          ear: 0.22,
          perclos: 0.31,
          heartRate: 72,
          fusionScore: 0.5,
          source: 'driver_monitor',
          location: { lat: 14.5, lng: 121, speed: 42 },
          km: 0.8,
          totalKm: 12.34,
        },
      ],
    });
    renderWithProviders(<ReadingHistory driverId="d1" driverName="Miguel" />);
    expect(await screen.findByTestId('history-table')).toHaveTextContent('58 readings');
    expect(screen.getByTestId('last-reading')).toHaveTextContent('5m ago');
    expect(screen.getByTestId('distance')).toHaveTextContent('12.3 km');
    expect(screen.getByTestId('history-table')).toHaveTextContent('+0.80 km');
    expect(screen.getByRole('link', { name: /42 km\/h/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps?q=14.5,121',
    );
  });
});

describe('messages in other languages', () => {
  test('quick reminders in Tagalog, Bisaya and Chinese', async () => {
    renderWithProviders(<MessagePanel driverId="d1" driverName="Miguel" />);
    await userEvent.click(screen.getByRole('tab', { name: 'Tagalog' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tawagan mo ako pagdating mo.' }));
    await waitFor(() =>
      expect(vi.mocked(messagesApi.sendMessage).mock.calls[0]).toEqual([
        'd1',
        { text: 'Tawagan mo ako pagdating mo.', kind: 'reminder' },
      ]),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Bisaya' }));
    expect(screen.getByRole('button', { name: 'Tawgi ko inig abot nimo.' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '中文' }));
    expect(screen.getByRole('button', { name: '到了给我打电话。' })).toBeInTheDocument();
    expect(screen.getByTestId('language-hint')).toHaveTextContent('any language');
  });
});
