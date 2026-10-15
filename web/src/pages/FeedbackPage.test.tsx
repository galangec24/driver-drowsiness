import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import * as feedbackApi from '../api/feedback';
import { renderWithProviders } from '../test/utils';
import { FeedbackPage } from './FeedbackPage';
import { FeedbackTab } from './admin/FeedbackTab';

const spies: Array<{ mockRestore: () => void }> = [];
function spy<K extends keyof typeof feedbackApi>(name: K) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = vi.spyOn(feedbackApi, name as any);
  spies.push(s);
  return s;
}
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
});

const ITEM: feedbackApi.Feedback = {
  id: 'f1',
  userId: 'u1',
  userName: 'Pat',
  userEmail: 'pat@example.com',
  category: 'bug',
  message: 'The map does not move.',
  attachments: [{ url: '/uploads/feedback/f1/1-shot.png', name: 'shot.png', mime: 'image/png', size: 2048 }],
  context: { platform: 'web', appVersion: '1.0.6', page: '/drivers/d1' },
  status: 'new',
  adminReply: null,
  repliedAt: null,
  createdAt: new Date().toISOString(),
};

describe('FeedbackPage', () => {
  test('sends a message with an attached screenshot, then shows it under "Your feedback"', async () => {
    const mine = spy('myFeedback').mockResolvedValueOnce([]).mockResolvedValue([ITEM]);
    const send = spy('sendFeedback').mockResolvedValue(ITEM);
    renderWithProviders(<FeedbackPage />, { route: '/feedback' });

    await userEvent.type(screen.getByLabelText('Your message'), 'The map does not move.');
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Attach files'), png);
    expect(await screen.findByText('shot.png')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]![0]).toMatchObject({
      category: 'bug',
      message: 'The map does not move.',
      platform: 'web',
      attachments: [{ name: 'shot.png', data: expect.stringMatching(/^data:image\/png;base64,/) }],
    });
    expect(await screen.findByTestId('my-feedback')).toHaveTextContent('Received');
    expect(mine).toHaveBeenCalledTimes(2);
  });

  test('files over 5 MB are refused before sending', async () => {
    spy('myFeedback').mockResolvedValue([]);
    renderWithProviders(<FeedbackPage />, { route: '/feedback' });
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Attach files'), big);
    expect(await screen.findByRole('alert')).toHaveTextContent('larger than 5 MB');
  });

  test('replies from the team are shown to the user', async () => {
    spy('myFeedback').mockResolvedValue([{ ...ITEM, status: 'resolved', adminReply: 'Fixed in 1.0.7, thanks!' }]);
    renderWithProviders(<FeedbackPage />, { route: '/feedback' });
    const item = await screen.findByTestId('my-feedback');
    expect(item).toHaveTextContent('Resolved');
    expect(item).toHaveTextContent('Reply from the team');
    expect(item).toHaveTextContent('Fixed in 1.0.7');
  });
});

describe('Admin feedback inbox', () => {
  test('shows the sender, context and attachments; a reply is sent', async () => {
    spy('adminFeedback').mockResolvedValue({ feedback: [ITEM], counts: { new: 1, in_progress: 0, resolved: 0 } });
    const update = spy('updateFeedback').mockResolvedValue({ ...ITEM, adminReply: 'Looking into it' });
    renderWithProviders(<FeedbackTab />);
    const card = await screen.findByTestId('feedback-f1');
    expect(card).toHaveTextContent('Pat · pat@example.com');
    expect(card).toHaveTextContent('web · v1.0.6 · /drivers/d1');
    expect(within(card).getByAltText('shot.png')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Received (1)' })).toBeInTheDocument();

    await userEvent.type(within(card).getByLabelText('Reply to the user'), 'Looking into it');
    await userEvent.click(within(card).getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('f1', { reply: 'Looking into it' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Mark resolved' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('f1', { status: 'resolved' }));
  });
});
