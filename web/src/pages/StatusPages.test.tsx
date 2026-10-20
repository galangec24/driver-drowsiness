import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppearanceCard, ThemeToggle } from '../components/ui/ThemeToggle';
import { MaintenancePage, NotFoundPage } from './StatusPages';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = 'dark';
  });

  test('the toggle switches dark <-> light and remembers it', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('gd:theme')).toBe('light');
    expect(screen.getByTestId('theme-toggle')).toHaveAccessibleName('Switch to dark theme');
    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  test('settings: picking Light / System', () => {
    render(<AppearanceCard />);
    fireEvent.click(screen.getByRole('radio', { name: /Light/ }));
    expect(screen.getByRole('radio', { name: /Light/ })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('radio', { name: /System/ }));
    expect(localStorage.getItem('gd:theme')).toBeNull();
  });
});

describe('status pages', () => {
  test('404 links back to the dashboard and the download page', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.getByText('Go to the dashboard').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Get the app').closest('a')).toHaveAttribute('href', '/download');
  });

  test('maintenance shows the message and comes back when the server is up', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const onBack = vi.fn();
    render(<MaintenancePage message="Updating the server" onBack={onBack} />);
    expect(screen.getByTestId('maintenance-message')).toHaveTextContent('Updating the server');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
