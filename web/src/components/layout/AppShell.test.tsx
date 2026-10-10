import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { AppShell } from './AppShell';
import { renderWithProviders } from '../../test/utils';

vi.mock('../../api/alerts', async (orig) => ({
  ...(await orig<typeof import('../../api/alerts')>()),
  listAlerts: vi.fn().mockResolvedValue({ alerts: [], unacknowledged: 3 }),
}));

function renderShell() {
  return renderWithProviders(
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<p>Dashboard body</p>} />
      </Route>
    </Routes>,
  );
}

describe('AppShell responsive behaviour', () => {
  test('renders page content inside a centred 1280px column', () => {
    renderShell();
    expect(screen.getByText('Dashboard body')).toBeInTheDocument();
    expect(screen.getByText('Dashboard body').closest('.max-w-content')).not.toBeNull();
  });

  test('side rail is hidden on mobile and shown from 640px (labels from 1024px)', () => {
    renderShell();
    const rail = screen.getByTestId('side-rail');
    expect(rail).toHaveClass('hidden', 'sm:flex', 'lg:w-60');
    const label = screen.getAllByText('Dashboard').find((el) => el.closest('[data-testid="side-rail"]'));
    expect(label).toHaveClass('hidden', 'lg:inline');
  });

  test('bottom nav is shown on mobile and hidden from 640px', () => {
    renderShell();
    const nav = screen.getByTestId('bottom-nav');
    expect(nav).toHaveClass('sm:hidden');
    expect(nav).not.toHaveClass('hidden');
  });

  test('both navs expose the same destinations', () => {
    renderShell();
    const railLinks = screen.getByTestId('side-rail').querySelectorAll('a');
    const bottomLinks = screen.getByTestId('bottom-nav').querySelectorAll('a');
    const hrefs = (list: NodeListOf<HTMLAnchorElement>) => Array.from(list).map((a) => a.getAttribute('href'));
    expect(hrefs(railLinks)).toEqual(['/', '/drivers', '/alerts', '/settings']);
    expect(hrefs(bottomLinks)).toEqual(hrefs(railLinks));
  });

  test('shows unacknowledged alert badge', async () => {
    renderShell();
    expect(await screen.findAllByText('3')).toHaveLength(2);
  });
});
