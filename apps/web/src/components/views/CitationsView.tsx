'use client';

import React from 'react';
import { CitationsManager } from '../citations/CitationsManager';
import { useDocument } from '../../context/DocumentContext';
import { useWorkspace } from '../../context/WorkspaceContext';

export const CitationsView: React.FC = () => {
  const { handleCitationInserted } = useDocument();
  const w = useWorkspace();

  return (
    <CitationsManager
      onOpenAddByIdentifier={w.openAddByIdentifier}
      onOpenBibtexModal={(tab) => w.openBibtexModal(tab || 'export')}
      onCitePaper={(paper) => {
        handleCitationInserted(paper);
        w.navigate('documents');
      }}
      onOpenZoteroModal={w.openZoteroModal}
    />
  );
};
