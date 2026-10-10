import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ServerWake } from './ServerWake';

// Restore only our fetch spy: restoreAllMocks would also wipe the shared matchMedia mock (test/setup.ts).
let fetchSpy: { mockRestore: () => void } | null = null;

describe('ServerWake', () => {
  afterEach(() => {
    vi.useRealTimers();
    fetchSpy?.mockRestore();
    fetchSpy = null;
  });

  test('a fast server never shows the overlay', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(<ServerWake />);
    await act(async () => {});
    expect(screen.queryByTestId('server-wake')).not.toBeInTheDocument();
  });

  test('a sleeping server shows "Waking up the server…" until it answers', async () => {
    vi.useFakeTimers();
    let answer: (r: Response) => void = () => {};
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((r) => (answer = r)));
    render(<ServerWake />);
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByTestId('server-wake')).toHaveTextContent('Waking up the server');
    await act(async () => {
      answer(new Response('{}', { status: 200 }));
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Waking up the server…')).not.toBeInTheDocument();
  });
});
