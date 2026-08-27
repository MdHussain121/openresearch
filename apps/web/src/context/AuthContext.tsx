'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'openresearch_tokens';
const USER_KEY = 'openresearch_user';

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
    const data = await res.json() as AuthTokens & { user: User };
    saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
    saveUser(data.user);
    setUser(data.user);
  }, []);

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
    const data = await res.json() as AuthTokens & { user: User };
    saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
    saveUser(data.user);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
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
