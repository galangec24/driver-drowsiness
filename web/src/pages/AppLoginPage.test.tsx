import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import * as authApi from '../api/auth';
import { renderWithProviders } from '../test/utils';
import { AppLoginPage } from './AppLoginPage';

describe('AppLoginPage (opened in the browser by the apps)', () => {
  test('a link without a valid hand-off id explains what to do', () => {
    renderWithProviders(<AppLoginPage />, { route: '/app-login?handoff=short' });
    expect(screen.getByTestId('app-login')).toHaveTextContent('This sign-in link is incomplete');
  });

  test('names the app that is waiting', () => {
    vi.spyOn(authApi, 'authConfig').mockResolvedValue({ googleClientId: null });
    renderWithProviders(<AppLoginPage />, { route: `/app-login?handoff=${'x'.repeat(43)}&app=android` });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign in to the Guardian Drive Android app');
  });
});
