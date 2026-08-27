'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles,
  MessageSquare,
  History,
  ShieldAlert,
  Download,
  AlertCircle,
} from 'lucide-react';
import { AcademicEditor } from '@openresearch/editor';
import { useDocument } from '../../context/DocumentContext';
import { useProject } from '../../context/ProjectContext';
import { usePaper } from '../../context/PaperContext';
import { useWorkspace, toGroundedPassage } from '../../context/WorkspaceContext';
import { t } from '../../i18n';
import { paperToBibRef } from '../../lib/paperToBibRef';
import { api } from '../../lib/api';
import type { GroundedPassage, GroundingState } from '@openresearch/ai';
import { BibliographicReference } from '@openresearch/citations';

export const DocumentsView: React.FC = () => {
  const { activeDocument, stats, citationStyle, updateStats, updateActiveDocument, handleCitationInserted, handleCitationDeleted } =
    useDocument();
  const { papers } = usePaper();
  const { activeProject } = useProject();
  const w = useWorkspace();
  const {
    enableGhostText,
    hourlyCap,
    hourlyUsage,
    recordAiRequest,
  } = w;

  // Title edit state
  const [docTitle, setDocTitle] = useState('');

  useEffect(() => {
    if (activeDocument) {
      setDocTitle(activeDocument.title || '');
    }
  }, [activeDocument]);

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setDocTitle(newTitle);
      updateActiveDocument({ title: newTitle });
    },
    [updateActiveDocument]
  );

  // Format Library Papers into Reference list
  const libraryReferences: BibliographicReference[] = useMemo(
    () => papers.map(paperToBibRef),
    [papers]
  );

  // Ghost Text Fast Request Handler
  const handleGhostTextRequest = useCallback(
    async (
      prefixText: string,
      paragraphContext: string,
      sectionHeading?: string
    ): Promise<{
      text: string;
      groundingState: GroundingState;
      sources: GroundedPassage[];
    } | null> => {
      if (!activeProject || !enableGhostText || (hourlyCap !== -1 && hourlyUsage.count >= hourlyCap)) {
        return null;
      }
      try {
        const res = await api.ai.autocomplete(activeProject.id, {
          prefix_text: prefixText,
          paragraph_context: paragraphContext,
          section_heading: sectionHeading,
          mode: 'ghost',
        });
        recordAiRequest();
        return {
          text: res.text || '',
          groundingState: (res.grounding_state as GroundingState) || 'general-knowledge',
          sources: (res.source_passages || []).map(toGroundedPassage),
        };
      } catch {
        return null;
      }
    },
    [activeProject, enableGhostText, hourlyCap, hourlyUsage.count, recordAiRequest]
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 flex justify-center">
      {/* 720px Centered Editor Column (UI/UX §3.2) */}
      <div className="w-full max-w-[var(--editor-max-width)] space-y-4">
        {/* Document Header & Metadata Bar */}
        <div className="border-b border-border-default pb-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-text-tertiary">
            <div className="flex items-center space-x-3">
              <span>{stats.words} {t('document.words')}</span>
              <span>•</span>
              <span>{stats.readingTimeMinutes} {t('document.minRead')}</span>
              <span>•</span>
              <span className="font-mono text-accent font-medium uppercase text-[11px]">{citationStyle} Style</span>
            </div>
            <div className="flex items-center space-x-2">
              {/* Comments Toggle Button */}
              <button
                onClick={w.toggleComments}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors ${
                  w.isCommentsOpen
                    ? 'bg-accent text-accent-solid-fg border-accent'
                    : 'bg-surface border-border-default text-text-primary hover:bg-sunken'
                }`}
                title="Document comments & threaded discussions"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Comments</span>
              </button>

              {/* Version History Button */}
              <button
                onClick={w.openVersionHistory}
                className="flex items-center space-x-1 px-2.5 py-1 rounded bg-surface hover:bg-sunken border border-border-default text-text-primary text-xs font-medium transition-colors"
                title="Document revision history & visual diffs"
              >
                <History className="w-3.5 h-3.5 text-accent" />
                <span>History</span>
              </button>

              {/* Claim Verification Badge Action */}
              <button
                onClick={() => {
                  w.setSourcePanelCollapsed(false);
                }}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors ${
                  w.unsupportedClaimsCount > 0
                    ? 'bg-trust-warning/10 border-trust-warning/30 text-trust-warning hover:bg-trust-warning/20'
                    : 'bg-surface border-border-default text-text-secondary hover:bg-sunken'
                }`}
                title="Inspect empirical assertions & claim verification flags"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>
                  {w.unsupportedClaimsCount > 0 ? `${w.unsupportedClaimsCount} claims` : 'Claims verified'}
                </span>
              </button>

              <button
                onClick={w.openExportModal}
                className="flex items-center space-x-1 px-2.5 py-1 rounded bg-surface hover:bg-sunken border border-border-default text-text-primary text-xs font-medium focus-visible:ring-2 focus-visible:ring-accent transition-colors"
                title="Export Document (.docx, .pdf, .md, .bib) (Ctrl+E)"
              >
                <Download className="w-3.5 h-3.5 text-accent" />
                <span>Export</span>
              </button>
            </div>
          </div>

          {/* Inline Editable Document Title */}
          <input
            type="text"
            value={docTitle}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder={t('editor.titlePlaceholder')}
            aria-label={t('editor.titlePlaceholder')}
            className="w-full bg-transparent font-serif font-bold text-2xl md:text-3xl text-text-primary tracking-tight focus:outline-none border-none p-0 placeholder:text-text-tertiary"
          />
        </div>

        {/* Tiptap Academic Core Editor */}
        <AcademicEditor
          key={activeDocument?.id || 'default-doc'}
          initialContent={activeDocument?.content_json}
          placeholder={t('editor.bodyPlaceholder')}
          citationStyle={citationStyle}
          libraryPapers={libraryReferences}
          enableGhostText={w.enableGhostText}
          providerLatencyTier={w.providerLatencyTier}
          onUpdate={(json: Record<string, unknown>, text: string, newStats: typeof stats) => {
            updateStats(newStats);
            updateActiveDocument({
              content_json: json as Record<string, unknown>,
              plain_text: text,
            });
          }}
          onSave={(json: Record<string, unknown>, text: string) => {
            updateActiveDocument({
              content_json: json as Record<string, unknown>,
              plain_text: text,
            });
          }}
          onCitationInserted={(paper: BibliographicReference) => {
            handleCitationInserted(paper);
            const author = paper.authors?.[0]?.familyName || 'Author';
            w.announce(`Citation inserted for ${author} (${paper.year || 'n.d.'}). Bibliography updated.`);
          }}
          onCitationDeleted={handleCitationDeleted}
          onInspectSource={(paperId: string) => w.openReaderForPaper(paperId)}
          onOpenAddByIdentifier={w.openAddByIdentifier}
          onTriggerContinuation={w.triggerContinuation}
          onTriggerAIEdit={w.triggerAIEdit}
          onOpenOutlineModal={w.openOutlineModal}
          onOpenExportModal={w.openExportModal}
          onGhostTextRequest={handleGhostTextRequest}
          onFocusChange={w.setIsEditorFocused}
          onInspectClaim={(_claimId: string, _text: string, _suggestedQuery?: string) => {
            w.setSourcePanelCollapsed(false);
          }}
        />

        {/* Editor Status Bar (UI/UX §4.2) */}
        <div className="flex items-center justify-between px-3 py-1.5 rounded border border-border-default bg-surface/80 text-[11px] text-text-tertiary">
          <div className="flex items-center space-x-2">
            {w.providerLatencyTier === 'fast' && w.enableGhostText ? (
              w.isEditorFocused ? (
                <div className="flex items-center space-x-1.5 text-accent font-medium">
                  <Sparkles className="w-3 h-3 text-accent animate-pulse" />
                  <span>{t('aiWriting.ghostActive')}</span>
                  <span className="text-text-tertiary font-mono">
                    [{w.hourlyUsage.count}/{w.hourlyCap === -1 ? '∞' : w.hourlyCap}]
                  </span>
                </div>
              ) : null
            ) : (
              <div className="flex items-center space-x-1.5 text-trust-danger">
                <AlertCircle className="w-3 h-3" />
                <span>{t('aiWriting.ghostDegraded')}</span>
                <button
                  onClick={() => w.navigate('settings')}
                  className="underline underline-offset-2 text-text-primary hover:text-accent ml-1"
                >
                  [Settings]
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <span>{stats.words} words</span>
            <span>•</span>
            <span>{stats.characters} chars</span>
            <span>•</span>
            <span className="uppercase font-mono">{citationStyle}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
