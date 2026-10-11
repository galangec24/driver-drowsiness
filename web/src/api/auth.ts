import axios from 'axios';
import { api } from './client';
import type { User } from './types';

export interface AuthResponse {
  token: string;
  user: User;
}

/** Registration when e-mail verification is on: no token until the e-mailed code is entered. */
export interface VerificationRequired {
  verificationRequired: true;
  email: string;
  retryAfterS: number;
  /** false when the code e-mail could not be sent (provider outage / misconfiguration). */
  emailSent?: boolean;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/login', {
    email,
    password,
  });
  return data;
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse | VerificationRequired> {
  const { data } = await api.post<AuthResponse | VerificationRequired>('/auth/register', { name, email, password });
  return data;
}

export async function verifyEmail(email: string, code: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/verify-email', {
    email,
    code,
  });
  return data;
}

export async function resendCode(email: string): Promise<{ ok: boolean; retryAfterS: number }> {
  const { data } = await api.post<{ ok: boolean; retryAfterS: number }>('/auth/resend-code', { email });
  return data;
}

/** Login refused because the e-mail isn't verified yet → {email, retryAfterS}, else null. */
export function unverifiedFromError(err: unknown): { email: string; retryAfterS: number; emailSent?: boolean } | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 403) return null;
  const details = (
    err.response.data as {
      details?: { code?: string; email?: string; retryAfterS?: number; emailSent?: boolean };
    }
  )?.details;
  if (details?.code !== 'EMAIL_NOT_VERIFIED' || !details.email) return null;
  return { email: details.email, retryAfterS: details.retryAfterS ?? 60, emailSent: details.emailSent };
}

/** Public sign-in options from the server (e.g. whether "Continue with Google" is set up). */
export async function authConfig(): Promise<{ googleClientId: string | null }> {
  const { data } = await api.get<{ googleClientId: string | null }>('/auth/config');
  return data;
}

/** Sign in / sign up with the ID token from Google's button. */
export async function googleSignIn(credential: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/google', { credential });
  return data;
}

/** E-mail a password reset code (same answer whether or not the account exists). */
export async function forgotPassword(email: string): Promise<{ ok: boolean; retryAfterS: number }> {
  const { data } = await api.post<{ ok: boolean; retryAfterS: number }>('/auth/forgot-password', { email });
  return data;
}

export async function resetPassword(email: string, code: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/reset-password', { email, code, password });
  return data;
}

export async function me(): Promise<User> {
  const { data } = await api.get<{ user: User }>('/auth/me');
  return data.user;
}

export async function pushConfig(): Promise<{ enabled: boolean }> {
  const { data } = await api.get<{ enabled: boolean }>('/push/config');
  return data;
}

export async function saveFcmToken(fcmToken: string): Promise<void> {
  await api.put('/auth/fcm-token', { fcmToken });
}
