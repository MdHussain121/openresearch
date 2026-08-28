'use client';

import React, { useState, useCallback } from 'react';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@openresearch/ui';
import { LiteratureMatrixView } from '../intelligence/LiteratureMatrixView';
import { ResearchGapAssistantView } from '../intelligence/ResearchGapAssistantView';
import { PaperReviewView } from '../intelligence/PaperReviewView';
import { ResearchGraphView } from '../intelligence/ResearchGraphView';
import { usePaper } from '../../context/PaperContext';
import { useProject } from '../../context/ProjectContext';
import { useDocument } from '../../context/DocumentContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { paperToBibRef } from '../../lib/paperToBibRef';
import { AlertCircle, X } from 'lucide-react';

type IntelligenceTab = 'matrix' | 'gaps' | 'review' | 'graph';

export const IntelligenceView: React.FC = () => {
  const [tab, setTab] = useState<IntelligenceTab>('matrix');
  const { papers, loadPapers } = usePaper();
  const { activeProject } = useProject();
  const { handleCitationInserted } = useDocument();
  const w = useWorkspace();
  const [addError, setAddError] = useState<string | null>(null);

  const addRecommendationToLibrary = useCallback(
    async (rec: { doi?: string; arxiv_id?: string; title?: string }) => {
      if (!activeProject) return;
      try {
        await api.citations.addByIdentifier(activeProject.id, rec.doi || rec.arxiv_id || '');
        await loadPapers();
        setAddError(null);
      } catch (err) {
        setAddError(getErrorMessage(err, `Could not add "${rec.title || 'recommendation'}" to the library.`));
      }
    },
    [activeProject, loadPapers]
  );

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as IntelligenceTab)}
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Intelligence Subnav Tabs */}
      <TabsList className="h-10 border-b border-border-default bg-surface px-4 flex items-center justify-start space-x-1 shrink-0 rounded-none">
        <TabsTrigger value="matrix" className="text-xs py-1.5 px-3">
          Literature Matrix
        </TabsTrigger>
        <TabsTrigger value="gaps" className="text-xs py-1.5 px-3">
          Research Gaps
        </TabsTrigger>
        <TabsTrigger value="review" className="text-xs py-1.5 px-3">
          Paper Review
        </TabsTrigger>
        <TabsTrigger value="graph" className="text-xs py-1.5 px-3">
          Research Graph
        </TabsTrigger>
      </TabsList>

      {addError && (
        <div
          role="alert"
          className="mx-4 mt-3 flex items-start justify-between gap-2 rounded border border-trust-danger/30 bg-trust-danger/10 px-3 py-2 text-xs text-trust-danger"
        >
          <span className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{addError}</span>
          </span>
          <button
            onClick={() => setAddError(null)}
            aria-label="Dismiss error"
            className="shrink-0 rounded p-0.5 hover:bg-trust-danger/15"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Subtab Views */}
      <div className="flex-1 overflow-hidden">
        <TabsContent value="matrix" className="h-full overflow-hidden mt-0">
          <LiteratureMatrixView
            onInsertIntoDocument={(markdown) => w.insertOutline(markdown)}
            onClose={() => w.navigate('documents')}
          />
        </TabsContent>
        <TabsContent value="gaps" className="h-full overflow-hidden mt-0">
          <ResearchGapAssistantView
            onInsertIntoDocument={(markdown) => w.insertOutline(markdown)}
            onClose={() => w.navigate('documents')}
          />
        </TabsContent>
        <TabsContent value="review" className="h-full overflow-hidden mt-0">
          <PaperReviewView onClose={() => w.navigate('documents')} />
        </TabsContent>
        <TabsContent value="graph" className="h-full overflow-hidden mt-0">
          <ResearchGraphView
            onOpenReader={(paperId) => w.openReaderForPaper(paperId)}
            onAskChat={(paperId) => w.openChatForPaper(paperId)}
            onCite={(paperId) => {
              const p = papers.find((x) => x.id === paperId);
              if (p) {
                handleCitationInserted(paperToBibRef(p));
                w.navigate('documents');
              }
            }}
            onAddToLibrary={addRecommendationToLibrary}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
};
