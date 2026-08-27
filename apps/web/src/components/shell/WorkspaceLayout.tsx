'use client';

import React, { useEffect } from 'react';
import { Check } from 'lucide-react';
import { useProject } from '../../context/ProjectContext';
import { useDocument } from '../../context/DocumentContext';
import { usePaper } from '../../context/PaperContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { TopBar } from './TopBar';
import { LeftNavigation } from './LeftNavigation';
import { SourcePanel } from './SourcePanel';
import { CommentsPanel } from '../comments/CommentsPanel';
import { ModalContainer } from './ModalContainer';
import { AIWritingFloatingOverlay } from './AIWritingFloatingOverlay';
import { TooltipProvider } from '@openresearch/ui';

/**
 * Persistent application chrome shared by every route in the (workspace)
 * route group: top bar, left navigation, source/comments panels, global
 * modals and floating overlays. Route content is rendered via {children},
 * so navigating between views never remounts the shell.
 */
export const WorkspaceLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { projects, activeProject, setActiveProject } = useProject();
  const {
    documents,
    activeDocument,
    saveStatus,
    citationStyle,
    toastMessage,
    setActiveDocument,
    createDocument,
    deleteDocument,
    clearToast,
  } = useDocument();
  const { papers } = usePaper();
  const w = useWorkspace();
  const [isToastClosing, setIsToastClosing] = React.useState(false);

  // Handle toast close with exit animation
  const handleToastClose = React.useCallback(() => {
    setIsToastClosing(true);
    setTimeout(() => {
      clearToast();
      setIsToastClosing(false);
    }, 150); // matches --duration-quick
  }, [clearToast]);

  // Responsive auto-collapse for mobile (<768px) and tablet (<1024px)
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined') {
        if (window.innerWidth < 768) {
          w.setIsSidebarCollapsed(true);
        }
        if (window.innerWidth < 1024) {
          w.setSourcePanelCollapsed(true);
        }
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        w.openSearchModal();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        w.openExportModal();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        w.navigate('aiChat');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        w.toggleSourcePanel();
      }
      if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        w.openShortcutsModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TooltipProvider delayDuration={80}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-text-primary">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-surface focus:p-2 focus:rounded focus:text-accent focus:outline-none focus:ring-2 focus:ring-accent">
          Skip to main content
        </a>
        {/* 48px Fixed Top Bar */}
        <TopBar
          projects={projects}
          activeProject={activeProject}
          setActiveProject={setActiveProject}
          saveStatus={saveStatus}
          isDark={w.isDark}
          toggleTheme={w.toggleTheme}
          onOpenSearch={() => w.openSearchModal()}
          onOpenShortcuts={w.openShortcutsModal}
          onOpenNewProject={w.openProjectModal}
          onOpenTeams={w.openTeamModal}
        />

        {/* Main Workspace Layout (Sidebar + Content + Source Panel) */}
        <div className="flex flex-1 overflow-hidden">
          {/* Collapsible Left Navigation */}
          <LeftNavigation
            papersCount={papers.length}
            citationStyle={citationStyle}
            documents={documents}
            activeDocument={activeDocument}
            setActiveDocument={setActiveDocument}
            createDocument={createDocument}
            deleteDocument={deleteDocument}
            onOpenPlugins={w.openPluginsModal}
            onOpenProviderQuota={w.openProviderQuotaModal}
            onOpenZotero={w.openZoteroModal}
          />

          {/* Center Main Content Area */}
          <main id="main-content" className="flex-1 flex overflow-hidden bg-canvas">
            {children}

            {/* Inline Comments & Discussion Thread Sidebar (Phase 9.2) */}
            <CommentsPanel
              documentId={activeDocument?.id || ''}
              isOpen={w.isCommentsOpen}
              onClose={() => w.toggleComments()}
            />

            {/* 320px Collapsible Source Panel (Right) */}
            <SourcePanel
              isCollapsed={w.isSourcePanelCollapsed}
              onToggle={w.toggleSourcePanel}
              activeSource={w.activeChatSource}
              unsupportedClaimsCount={w.unsupportedClaimsCount}
              onFindSourcesForClaim={(query) => w.openSearchModal(query)}
              onClaimsCounted={(unsupported) => w.setUnsupportedClaimsCount(unsupported)}
              onOpenPaperInReader={(paperId) => w.openReaderForPaper(paperId)}
              onOpenBibtexModal={(tab) => w.openBibtexModal(tab || 'export')}
            />
          </main>
        </div>

        {/* Floating AI Writing Overlay (Continuation & Reversible Edit Cards) */}
        <AIWritingFloatingOverlay
          isContinuationOpen={w.continuation.isOpen}
          isContinuationLoading={w.continuation.isLoading}
          continuationText={w.continuation.text}
          continuationGroundingState={w.continuation.groundingState}
          continuationSources={w.continuation.sources}
          continuationLatency={w.continuation.latency}
          onAcceptContinuation={w.continuation.accept}
          onRegenerateContinuation={w.continuation.regenerate}
          onDismissContinuation={w.continuation.dismiss}
          onInspectSource={(paperId, _pageNum, _passage) => w.openReaderForPaper(paperId)}
          isEditReviewOpen={w.editReview.isOpen}
          isEditReviewLoading={w.editReview.isLoading}
          editAction={w.editReview.action}
          editOriginalText={w.editReview.originalText}
          editSuggestedText={w.editReview.suggestedText}
          editExplanation={w.editReview.explanation}
          editChangesSummary={w.editReview.changesSummary}
          editGroundingState={w.editReview.groundingState}
          editSources={w.editReview.sources}
          editLatency={w.editReview.latency}
          onAcceptEdit={w.editReview.accept}
          onRejectEdit={w.editReview.reject}
          onRegenerateEdit={w.editReview.regenerate}
        />

        {/* Modals Container */}
        <ModalContainer />

        {/* Screen Reader Live Region (WCAG 2.1 AA) */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {w.srAnnouncement}
        </div>

        {/* Floating Reference Toast Notification (UI/UX §4.1) - bottom-center with progress */}
{(toastMessage || isToastClosing) && (
          <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-border-default bg-surface px-4 py-2.5 shadow-xl text-xs font-medium text-text-primary flex items-center space-x-2 overflow-hidden transition-[transform,opacity] duration-250 ease-smooth-out data-[state=closing]:duration-150 data-[state=closing]:ease-in toast-enter"
            style={{
              transitionProperty: 'transform, opacity',
              transitionDuration: 'var(--duration-emphasis), var(--duration-emphasis)',
              transitionTimingFunction: 'var(--ease-smooth-out), var(--ease-smooth-out)',
            }}
            data-state={isToastClosing ? 'closing' : 'open'}
          >
            <Check className="w-4 h-4 text-accent shrink-0" />
            <span>{toastMessage}</span>
            <button onClick={handleToastClose} aria-label="Dismiss notification" className="ml-2 text-text-tertiary hover:text-text-primary transition-colors">
              ✕
            </button>
            {/* Auto-dismiss progress bar */}
            <div className="absolute bottom-0 left-0 h-0.5 bg-accent/60 w-full origin-left animate-[shrink_4s_linear_forwards]" style={{ animationName: 'shrink' }} />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
