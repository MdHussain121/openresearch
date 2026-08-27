'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { resolveApiUrl } from '../lib/api/client';

export interface User {
  id: string;
  email: string;
  name: string;
  personal_owner_id: string;
}

interface AuthTokens {
  access_token: string;
  refresh_token: string | null;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOfflineMode: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  getToken: () => string | null;
  /** Attempt to silently refresh the access token using the stored refresh token.
   *  Returns the new access token on success, or null if refresh failed (user
   *  should be logged out). */
  refreshAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'openresearch_tokens';
const USER_KEY = 'openresearch_user';

/** Refresh tokens 5 minutes before the access token expires (24h default). */
const REFRESH_PROACTIVE_MS = 23 * 60 * 60 * 1000;

function loadTokens(): AuthTokens | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

function saveTokens(tokens: AuthTokens): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function loadUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

function saveUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const storedUser = loadUser();
    const storedTokens = loadTokens();
    if (storedUser && storedTokens) {
      setUser(storedUser);
      setIsLoading(false);
      return;
    }
    setIsLoading(false);
  }, []);

  /** Schedule a proactive token refresh so the user never experiences a
   *  401 mid-session.  Called after every successful login/register and
   *  after each successful refresh. */
  const scheduleRefresh = useCallback((tokenCreatedAtMs: number) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const elapsed = Date.now() - tokenCreatedAtMs;
    const delay = Math.max(REFRESH_PROACTIVE_MS - elapsed, 60_000); // at least 60 s
    refreshTimerRef.current = setTimeout(async () => {
      await refreshAccessToken();
    }, delay);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${resolveApiUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(body.detail || 'Login failed');
    }
    const data = (await res.json()) as AuthTokens & { user: User };
    saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
    saveUser(data.user);
    setUser(data.user);
    scheduleRefresh(Date.now());
  }, [scheduleRefresh]);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const res = await fetch(`${resolveApiUrl()}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: 'Registration failed' }));
      throw new Error(body.detail || 'Registration failed');
    }
    const data = (await res.json()) as AuthTokens & { user: User };
    saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
    saveUser(data.user);
    setUser(data.user);
    scheduleRefresh(Date.now());
  }, [scheduleRefresh]);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) {
      logout();
      return null;
    }
    try {
      const res = await fetch(`${resolveApiUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: tokens.refresh_token }),
      });
      if (!res.ok) {
        // Refresh token is invalid/expired — force re-login
        clearTokens();
        setUser(null);
        window.location.href = '/login';
        return null;
      }
      const data = (await res.json()) as AuthTokens & { user: User };
      saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token ?? tokens.refresh_token });
      saveUser(data.user);
      setUser(data.user);
      scheduleRefresh(Date.now());
      return data.access_token;
    } catch {
      // Network error — don't logout, just return null so caller can retry later
      return null;
    }
  }, [scheduleRefresh]);

  const logout = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    clearTokens();
    setUser(null);
    window.location.href = '/login';
  }, []);

  const getToken = useCallback(() => {
    const tokens = loadTokens();
    return tokens?.access_token ?? null;
  }, []);

  const value: AuthContextType = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    isOfflineMode: false,
    login,
    register,
    logout,
    getToken,
    refreshAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
