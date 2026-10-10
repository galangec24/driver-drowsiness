import { api } from './client';
import type { User } from './types';

export interface AuthResponse {
  token: string;
  user: User;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
  return data;
}

export async function register(name: string, email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/register', { name, email, password });
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
