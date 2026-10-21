import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MessagePanel } from './MessagePanel';
import { AlertCard } from '../alert/AlertCard';
import { makeAlert, renderWithProviders } from '../../test/utils';
import * as messagesApi from '../../api/messages';

vi.mock('../../api/messages', async (orig) => ({
  ...(await orig<typeof import('../../api/messages')>()),
  listMessages: vi.fn(),
  sendMessage: vi.fn(),
}));

describe('messages to the driver', () => {
  test('a quick reminder or a written message is sent; history shows whether it was read aloud', async () => {
    vi.mocked(messagesApi.listMessages).mockResolvedValue([
      {
        id: 'm1',
        driverId: 'd1',
        fromName: 'Maria',
        text: 'Call me when you arrive.',
        kind: 'reminder',
        status: 'delivered',
        deliveredAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(messagesApi.sendMessage).mockResolvedValue({
      message: {
        id: 'm2',
        driverId: 'd1',
        fromName: 'Maria',
        text: 'x',
        kind: 'message',
        status: 'pending',
        deliveredAt: null,
        createdAt: new Date().toISOString(),
      },
      carOnline: true,
    });
    renderWithProviders(<MessagePanel driverId="d1" driverName="Galang Cruz" />);
    expect(await screen.findByTestId('message-history')).toHaveTextContent('Read aloud in the car');

    await userEvent.click(screen.getByRole('button', { name: 'Please take a break at the next safe stop.' }));
    await waitFor(() =>
      expect(vi.mocked(messagesApi.sendMessage).mock.calls[0]).toEqual([
        'd1',
        { text: 'Please take a break at the next safe stop.', kind: 'reminder', lang: 'en' },
      ]),
    );
    await userEvent.type(screen.getByLabelText('Message'), 'Dinner is ready');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(vi.mocked(messagesApi.sendMessage).mock.calls[1]).toEqual([
        'd1',
        { text: 'Dinner is ready', kind: 'message', lang: 'auto' },
      ]),
    );
  });
});

describe('repeated detections', () => {
  test('one alert shows how many times it was detected', () => {
    render(<AlertCard alert={makeAlert({ repeatCount: 3, lastDetectedAt: new Date().toISOString() })} />);
    expect(screen.getByTestId('alert-repeats')).toHaveTextContent('Detected 3 times · last just now');
  });

  test('a single detection has no counter', () => {
    render(<AlertCard alert={makeAlert()} />);
    expect(screen.queryByTestId('alert-repeats')).not.toBeInTheDocument();
  });
});
