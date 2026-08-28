'use client';

import React, { useEffect } from 'react';
import { AuthProvider } from '../../context/AuthContext';
import { ProjectProvider } from '../../context/ProjectContext';
import { DocumentProvider } from '../../context/DocumentContext';
import { PaperProvider } from '../../context/PaperContext';
import { WorkspaceProvider } from '../../context/WorkspaceContext';
import { WorkspaceLayout } from '../../components/shell/WorkspaceLayout';
import { initApiUrl } from '../../lib/api/client';

let apiUrlInitialized = false;

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
      <ProjectProvider>
        <DocumentProvider>
          <PaperProvider>
            <WorkspaceProvider>
              <WorkspaceLayout>{children}</WorkspaceLayout>
            </WorkspaceProvider>
          </PaperProvider>
        </DocumentProvider>
      </ProjectProvider>
    </AuthProvider>
  );
}
