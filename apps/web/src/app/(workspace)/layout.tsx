'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '../../context/AuthContext';
import { ProjectProvider } from '../../context/ProjectContext';
import { DocumentProvider } from '../../context/DocumentContext';
import { PaperProvider } from '../../context/PaperContext';
import { WorkspaceProvider } from '../../context/WorkspaceContext';
import { WorkspaceLayout } from '../../components/shell/WorkspaceLayout';
import { initApiUrl } from '../../lib/api/client';

let apiUrlInitialized = false;

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <div className="text-sm text-text-secondary">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}

export default function WorkspaceLayoutRoot({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!apiUrlInitialized) {
      apiUrlInitialized = true;
      initApiUrl();
    }
  }, []);

  return (
    <AuthProvider>
      <AuthGuard>
        <ProjectProvider>
          <DocumentProvider>
            <PaperProvider>
              <WorkspaceProvider>
                <WorkspaceLayout>{children}</WorkspaceLayout>
              </WorkspaceProvider>
            </PaperProvider>
          </DocumentProvider>
        </ProjectProvider>
      </AuthGuard>
    </AuthProvider>
  );
}
