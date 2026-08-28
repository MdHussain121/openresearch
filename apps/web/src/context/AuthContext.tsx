'use client';

import React, { createContext, useCallback, useContext } from 'react';

export interface User {
  id: string;
  email: string;
  name: string;
  personal_owner_id: string;
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
  refreshAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Local-first dummy user — no authentication required.
const LOCAL_USER: User = {
  id: 'local-user-id',
  email: 'local@openresearch.dev',
  name: 'Local Researcher',
  personal_owner_id: 'local-owner-id',
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // No loading state — app is immediately authenticated offline
  const login = useCallback(async () => {
    // No-op: auth removed
  }, []);

  const register = useCallback(async () => {
    // No-op: auth removed
  }, []);

  const logout = useCallback(() => {
    // No-op: no session to clear in offline mode
  }, []);

  const getToken = useCallback(() => null as string | null, []);

  const refreshAccessToken = useCallback(async () => null as string | null, []);

  const value: AuthContextType = {
    user: LOCAL_USER,
    isAuthenticated: true,
    isLoading: false,
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
