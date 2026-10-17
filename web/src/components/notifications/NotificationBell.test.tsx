import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { NotificationBell } from './NotificationBell';
import { AlertCard } from '../alert/AlertCard';
import { makeAlert, renderWithProviders } from '../../test/utils';
import * as alertsApi from '../../api/alerts';

vi.mock('../../api/alerts', async (orig) => ({
  ...(await orig<typeof import('../../api/alerts')>()),
  listAlerts: vi.fn(),
  markAlertRead: vi.fn(),
  markAllAlertsRead: vi.fn().mockResolvedValue(2),
}));

const unreadAlert = makeAlert({
  id: 'u1',
  read: false,
  sensorSnapshot: { fatigueReason: 'Fatigue signs: repeated yawning (3+ in 10 min)' },
});
const readAlert = makeAlert({ id: 'r1', read: true, acknowledged: true, driverName: 'Ben' });

describe('notifications: separate Unread and Read lists', () => {
  beforeEach(() => {
    vi.mocked(alertsApi.listAlerts).mockImplementation(async (f = {}) =>
      f.read === false
        ? { alerts: [unreadAlert], unacknowledged: 1, unread: 1, expired: 0 }
        : { alerts: [readAlert], unacknowledged: 1, unread: 1, expired: 0 },
    );
    vi.mocked(alertsApi.markAlertRead).mockImplementation(async ({ id, read = true }) => ({
      ...unreadAlert,
      id,
      read,
    }));
  });

  test('the bell shows the unread count and both tabs', async () => {
    renderWithProviders(<NotificationBell />);
    expect(await screen.findByTestId('unread-badge')).toHaveTextContent('1');
    await userEvent.click(screen.getByRole('button', { name: /notifications, 1 unread/i }));

    const unread = await screen.findByTestId('notifications-unread');
    expect(unread).toHaveTextContent('Alex: Drowsy');
    expect(unread).toHaveTextContent('repeated yawning (3+ in 10 min)');
    expect(unread).toHaveTextContent('Needs acknowledgement');

    await userEvent.click(screen.getByRole('tab', { name: 'Read' }));
    expect(await screen.findByTestId('notifications-read')).toHaveTextContent('Ben: Drowsy');
  });

  test('mark read, and mark all as read', async () => {
    renderWithProviders(<NotificationBell />);
    await userEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark read' }));
    await waitFor(() =>
      expect(vi.mocked(alertsApi.markAlertRead).mock.calls[0]?.[0]).toEqual({ id: 'u1', read: true }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(alertsApi.markAllAlertsRead).toHaveBeenCalled());
  });
});

describe('AlertCard: previous-day alerts and removing', () => {
  test('an alert not acknowledged on its day can only be removed', () => {
    render(<AlertCard alert={makeAlert({ expired: true })} onAcknowledge={() => {}} onRemove={() => {}} />);
    expect(screen.getByTestId('expired-label')).toHaveTextContent('Unacknowledged · from a previous day');
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /false alarm/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('danger-glow')).not.toBeInTheDocument();
  });

  test('remove asks first, then removes', async () => {
    const onRemove = vi.fn();
    render(<AlertCard alert={makeAlert({ id: 'x9' })} onRemove={onRemove} />);
    await userEvent.click(screen.getByTestId('remove-alert'));
    expect(screen.getByTestId('remove-confirm')).toHaveTextContent('Remove this alert?');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('x9');
  });

  test('shows why the camera judged fatigue', () => {
    render(
      <AlertCard
        alert={makeAlert({
          type: 'warning',
          sensorSnapshot: { fatigueReason: 'Fatigue signs: unusual blinking and yawning' },
        })}
      />,
    );
    expect(screen.getByTestId('fatigue-reason')).toHaveTextContent('unusual blinking and yawning');
  });
});
