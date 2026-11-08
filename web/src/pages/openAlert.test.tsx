/**
 * Clicking a notification (the bell list, or the Windows / browser pop-up) opens that alert's
 * details on the Alerts page and marks it read.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { AlertsPage } from './AlertsPage';
import { NotificationBell } from '../components/notifications/NotificationBell';
import { makeAlert, renderWithProviders } from '../test/utils';
import * as alertsApi from '../api/alerts';

vi.mock('../api/alerts', async (orig) => ({
  ...(await orig<typeof import('../api/alerts')>()),
  listAlerts: vi.fn(),
  markAlertRead: vi.fn(),
}));
vi.mock('../api/drivers', () => ({ listDrivers: vi.fn().mockResolvedValue([]) }));

const alert = makeAlert({ id: 'x9', read: false, driverName: 'Galang', type: 'microsleep' });

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

beforeEach(() => {
  vi.mocked(alertsApi.listAlerts).mockResolvedValue({ alerts: [alert], unacknowledged: 1, unread: 1, expired: 0 });
  vi.mocked(alertsApi.markAlertRead).mockResolvedValue({ ...alert, read: true });
});

test('a notification in the bell opens that alert, not the driver page', async () => {
  renderWithProviders(
    <>
      <NotificationBell />
      <Where />
    </>,
  );
  await userEvent.click(await screen.findByRole('button', { name: /notifications/i }));
  await userEvent.click(await screen.findByText(/Galang: /));
  expect(screen.getByTestId('where')).toHaveTextContent('/alerts?open=x9');
});

test('/alerts?open=<id> marks the alert read and shows its details', async () => {
  renderWithProviders(
    <Routes>
      <Route path="/alerts" element={<AlertsPage />} />
    </Routes>,
    { route: '/alerts?open=x9' },
  );
  expect(await screen.findByTestId('alert-detail')).toHaveTextContent('Galang');
  await waitFor(() => expect(alertsApi.markAlertRead).toHaveBeenCalledWith({ id: 'x9', read: true }));
});
