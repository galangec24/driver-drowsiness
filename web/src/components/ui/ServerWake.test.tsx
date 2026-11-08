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

  test('502/503 while Render wakes the server are retried, not shown as a failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    render(<ServerWake />);
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(3100);
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/taking too long/i)).not.toBeInTheDocument();
    // Answered: the wait counter stops (the overlay then fades out on animation frames).
    const shown = screen.getByTestId('server-wake').textContent;
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId('server-wake')?.textContent ?? shown).toBe(shown);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
