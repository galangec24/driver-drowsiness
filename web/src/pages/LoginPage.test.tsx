import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { LoginPage, validateAuthForm } from './LoginPage';
import { renderWithProviders } from '../test/utils';
import * as authApi from '../api/auth';

describe('validateAuthForm', () => {
  test('login requires a valid email and a password', () => {
    expect(validateAuthForm('login', { name: '', email: 'bad', password: '' })).toEqual({
      email: 'Enter a valid email',
      password: 'Enter your password',
    });
    expect(validateAuthForm('login', { name: '', email: 'a@b.co', password: 'x' })).toEqual({});
  });

  test('register requires a name and 8+ char password', () => {
    expect(validateAuthForm('register', { name: ' ', email: 'a@b.co', password: 'short' })).toEqual({
      name: 'Enter your name',
      password: 'Use at least 8 characters',
    });
  });
});

describe('LoginPage', () => {
  test('shows field errors and does not call the API when invalid', async () => {
    const spy = vi.spyOn(authApi, 'login');
    renderWithProviders(<LoginPage />, { route: '/login' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  test('signs in and stores the JWT', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      token: 'jwt-123',
      user: { id: 'u1', name: 'Pat', email: 'pat@example.com', role: 'parent', createdAt: '' },
    });
    renderWithProviders(<LoginPage />, { route: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'pat@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(authApi.login).toHaveBeenCalledWith('pat@example.com', 'secret');
    expect(localStorage.getItem('gd:token')).toBe('jwt-123');
  });
});

describe('LoginPage polish', () => {
  test('fields have icons, password can be revealed, and a 3D loader shows while signing in', async () => {
    let resolve: (v: Awaited<ReturnType<typeof authApi.login>>) => void = () => {};
    vi.spyOn(authApi, 'login').mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithProviders(<LoginPage />, { route: '/login' });

    expect(screen.getAllByTestId('input-icon')).toHaveLength(2);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');

    await userEvent.type(screen.getByLabelText('Email'), 'pat@example.com');
    await userEvent.type(password, 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByTestId('orbit-loader')).toHaveTextContent('Signing you in…');
    resolve({ token: 't', user: { id: 'u1', name: 'Pat', email: 'pat@example.com', role: 'parent', createdAt: '' } });
  });
});

describe('LoginPage e-mail verification', () => {
  test('registering asks for the e-mailed code; a pasted code signs in', async () => {
    vi.spyOn(authApi, 'register').mockResolvedValue({ verificationRequired: true, email: 'pat@example.com', retryAfterS: 60 });
    const verify = vi.spyOn(authApi, 'verifyEmail').mockResolvedValue({
      token: 'jwt-ok',
      user: { id: 'u1', name: 'Pat', email: 'pat@example.com', role: 'parent', createdAt: '' },
    });
    renderWithProviders(<LoginPage />, { route: '/login' });
    await userEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Pat');
    await userEvent.type(screen.getByLabelText('Email'), 'pat@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'supersecret1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByTestId('otp-form')).toHaveTextContent('pat@example.com');
    expect(localStorage.getItem('gd:token')).toBeNull();
    expect(screen.getByRole('button', { name: /Resend code in \d+s/ })).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Digit 1'));
    await userEvent.paste('482913');
    expect(verify).toHaveBeenCalledWith('pat@example.com', '482913');
    await vi.waitFor(() => expect(localStorage.getItem('gd:token')).toBe('jwt-ok'));
  });

  test('signing in to an unverified account switches to the code step', async () => {
    const { AxiosError } = await import('axios');
    const err = new AxiosError('403', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 403,
      statusText: 'Forbidden',
      headers: {},
      config: {} as never,
      data: { error: 'Verify your e-mail first', details: { code: 'EMAIL_NOT_VERIFIED', email: 'pat@example.com', retryAfterS: 30 } },
    });
    vi.spyOn(authApi, 'login').mockRejectedValue(err);
    renderWithProviders(<LoginPage />, { route: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'pat@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('otp-form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend code in 30s/ })).toBeDisabled();
  });
});
