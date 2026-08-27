'use client';

import React from 'react';
import { usePaper } from '../../context/PaperContext';
import { useDocument } from '../../context/DocumentContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { ResearchLibrary } from '../library/ResearchLibrary';
import { PdfReader } from '../reader/PdfReader';
import { paperToBibRef } from '../../lib/paperToBibRef';
import type { Paper } from '../../context/PaperContext';

export const LibraryView: React.FC = () => {
  const { activePaper, selectPaper } = usePaper();
  const { handleCitationInserted } = useDocument();
  const w = useWorkspace();

  if (activePaper) {
    return (
      <PdfReader
        paper={activePaper}
        onBack={() => selectPaper(null)}
        onOpenChat={(paper) => w.openChatForPaper(paper.id)}
      />
    );
  }

  return (
    <ResearchLibrary
      onOpenPaper={(paper) => selectPaper(paper)}
      onOpenChat={(paper) => w.openChatForPaper(paper.id)}
      onCitePaper={(paper: Paper) => {
        handleCitationInserted(paperToBibRef(paper));
        w.navigate('documents');
      }}
      onOpenAddByIdentifier={w.openAddByIdentifier}
      onOpenBibtexModal={(tab) => w.openBibtexModal(tab || 'import')}
      onOpenZoteroModal={w.openZoteroModal}
    />
  );
};
