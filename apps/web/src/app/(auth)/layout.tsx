'use client';

import React from 'react';
import { AuthProvider } from '../../context/AuthContext';
import { DesktopTitleBar } from '../../components/shell/DesktopTitleBar';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col">
        <DesktopTitleBar />
        <div className="flex-1 flex flex-col">
          {children}
        </div>
      </div>
    </AuthProvider>
  );
}
