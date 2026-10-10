import axios, { AxiosError } from 'axios';
import { getToken, notifyUnauthorized } from '../store/auth';

/** Public, non-secret: where our backend lives. All data flows through it. */
export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  // Dev default: the backend on the same host that served this page (works on localhost and on a
  // phone opening http://<PC-IP>:5173). Production builds set VITE_API_URL explicitly.
  `${window.location.protocol}//${window.location.hostname}:3000`;

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 20000,
});

// JWT interceptor
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => {
    const isAuthCall = error.config?.url?.startsWith('/auth/');
    if (error.response?.status === 401 && !isAuthCall) notifyUnauthorized();
    return Promise.reject(error);
  },
);

/** Human-readable message from an API error. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return 'Cannot reach the Guardian Drive server';
    const data = err.response.data as { error?: string } | undefined;
    return data?.error || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

export function isNetworkError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response;
}

/** Reference photos may be stored relative to the API (local dev) or absolute (Cloudinary). */
export function assetUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${API_URL}${url}` : url;
}
