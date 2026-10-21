import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../api/types';

/** JWT storage: localStorage (survives reloads/PWA restarts) + React context. */
const TOKEN_KEY = 'gd:token';
const USER_KEY = 'gd:user';
const UNAUTHORIZED_EVENT = 'gd:unauthorized';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return safeGet(TOKEN_KEY);
}

export function notifyUnauthorized(): void {
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

interface AuthState {
  token: string | null;
  user: User | null;
  setSession: (token: string, user: User) => void;
  logout: () => void;
  /** After editing the profile: same session, new details. */
  updateUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readUser(): User | null {
  const raw = safeGet(USER_KEY);
  try {
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<User | null>(() => readUser());

  const setSession = useCallback((t: string, u: User) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {
      // Private mode: session lives in memory only.
    }
    setToken(t);
    setUser(u);
  }, []);

  const updateUser = useCallback((u: User) => {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {
      // memory only
    }
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      // ignore
    }
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  const value = useMemo(
    () => ({ token, user, setSession, logout, updateUser }),
    [token, user, setSession, logout, updateUser],
  );
  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
