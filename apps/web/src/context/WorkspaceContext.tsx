'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useProject } from './ProjectContext';
import { useDocument } from './DocumentContext';
import { usePaper, Paper } from './PaperContext';
import { api } from '../lib/api';
import type { AIEditActionType, GroundedPassage, GroundingState } from '@openresearch/ai';

export type NavKey = 'documents' | 'library' | 'citations' | 'intelligence' | 'aiChat' | 'settings';

export const NAV_ROUTES: Record<NavKey, string> = {
  documents: '/documents',
  library: '/library',
  citations: '/citations',
  intelligence: '/intelligence',
  aiChat: '/chat',
  settings: '/settings',
};

const ROUTE_TO_NAV: Record<string, NavKey> = Object.fromEntries(
  Object.entries(NAV_ROUTES).map(([nav, route]) => [route, nav])
) as Record<string, NavKey>;

export const toGroundedPassage = (
  sp: GroundedPassage | Record<string, unknown>
): GroundedPassage => {
  const p = sp as Record<string, unknown>;
  return {
    paperId: String(p.paper_id || p.paperId || ''),
    paperTitle: String(p.paper_title || p.paperTitle || ''),
    passageText: String(p.passage_text || p.passageText || ''),
    pageNumber:
      typeof p.page_number === 'number'
        ? p.page_number
        : typeof p.pageNumber === 'number'
          ? p.pageNumber
          : 1,
    section: String(p.section || ''),
    paragraph: typeof p.paragraph === 'number' ? p.paragraph : undefined,
    authors: typeof p.authors === 'string' ? p.authors : 'Unknown',
    year: typeof p.year === 'number' ? p.year : undefined,
    confidence: typeof p.confidence === 'number' ? p.confidence : 1.0,
    score: typeof p.score === 'number' ? p.score : undefined,
  };
};

const INITIAL_HOUR_KEY = Math.floor(Date.now() / 3600000);

export interface ContinuationState {
  isOpen: boolean;
  isLoading: boolean;
  text: string;
  error: string | null;
  groundingState: GroundingState;
  sources: GroundedPassage[];
  latency: number;
  accept: () => void;
  regenerate: () => void;
  dismiss: () => void;
}

export interface EditReviewState {
  isOpen: boolean;
  isLoading: boolean;
  action: AIEditActionType;
  originalText: string;
  suggestedText: string;
  explanation?: string;
  changesSummary?: string;
  groundingState: GroundingState;
  sources: GroundedPassage[];
  latency: number;
  accept: () => void;
  reject: () => void;
  regenerate: () => void;
}

export interface ModalsState {
  isProjectOpen: boolean;
  isShortcutsOpen: boolean;
  isSearchOpen: boolean;
  isExportOpen: boolean;
  isOutlineOpen: boolean;
  isAddByIdentifierOpen: boolean;
  isBibtexOpen: boolean;
  bibtexTab: 'import' | 'export';
  isZoteroOpen: boolean;
  isProviderQuotaOpen: boolean;
  isVersionHistoryOpen: boolean;
  isPluginsOpen: boolean;
  searchSeedQuery: string;
  closeProject: () => void;
  closeShortcuts: () => void;
  closeSearch: () => void;
  closeExport: () => void;
  closeOutline: () => void;
  closeAddByIdentifier: () => void;
  closeBibtex: () => void;
  closeZotero: () => void;
  closeProviderQuota: () => void;
  closeVersionHistory: () => void;
  closePlugins: () => void;
}

interface WorkspaceContextType {
  // Navigation
  activeNav: NavKey;
  navigate: (nav: NavKey) => void;
  openReaderForPaper: (paperId: string) => void;
  openPaperInReader: (paper: Paper) => void;
  openChatForPaper: (paperId: string) => void;
  chatInitialPaperId: string | null;
  clearChatSeed: () => void;

  // Shell panels
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (v: boolean) => void;
  isSourcePanelCollapsed: boolean;
  setSourcePanelCollapsed: (v: boolean) => void;
  toggleSourcePanel: () => void;
  isCommentsOpen: boolean;
  toggleComments: () => void;
  activeChatSource: GroundedPassage | null;
  setActiveChatSource: (s: GroundedPassage | null) => void;
  unsupportedClaimsCount: number;
  setUnsupportedClaimsCount: (n: number) => void;

  // Modals
  modals: ModalsState;
  openSearchModal: (seedQuery?: string) => void;
  openExportModal: () => void;
  openShortcutsModal: () => void;
  openProjectModal: () => void;
  openPluginsModal: () => void;
  openProviderQuotaModal: () => void;
  openZoteroModal: () => void;
  openOutlineModal: () => void;
  openAddByIdentifier: () => void;
  openBibtexModal: (tab?: 'import' | 'export') => void;
  openVersionHistory: () => void;

  // Theme & density
  isDark: boolean;
  toggleTheme: () => void;
  densityMode: 'comfortable' | 'compact';
  toggleDensity: () => void;

  // AI writing assistance settings
  enableGhostText: boolean;
  setEnableGhostText: (v: boolean) => void;
  providerLatencyTier: 'fast' | 'moderate' | 'slow';
  setProviderLatencyTier: (t: 'fast' | 'moderate' | 'slow') => void;
  hourlyCap: number;
  setHourlyCap: (n: number) => void;
  hourlyUsage: { count: number; hourKey: number };
  recordAiRequest: () => void;
  isEditorFocused: boolean;
  setIsEditorFocused: (v: boolean) => void;

  // AI writing requests (editor -> backend -> floating cards)
  continuation: ContinuationState;
  editReview: EditReviewState;
  triggerContinuation: (
    prefix: string,
    paragraphContext: string,
    sectionHeading?: string
  ) => Promise<void>;
  triggerAIEdit: (text: string, action: AIEditActionType) => Promise<void>;
  registerContinuationInserter: (fn: ((text: string) => boolean) | null) => void;

  // Misc actions
  srAnnouncement: string;
  announce: (message: string) => void;
  insertOutline: (outlineMarkdownOrJson: unknown, plainText?: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { activeProject } = useProject();
  const { activeDocument, updateActiveDocument } = useDocument();
  const { papers, selectPaper } = usePaper();

  // --------------------------------------------------- Accessibility (WCAG 2.1)
  const [srAnnouncement, setSrAnnouncement] = useState('');
  const announce = useCallback((message: string) => {
    setSrAnnouncement('');
    requestAnimationFrame(() => setSrAnnouncement(message));
  }, []);

  // ---------------------------------------------------------------- Navigation
  const activeNav: NavKey = ROUTE_TO_NAV[pathname] ?? 'documents';
  const navigate = useCallback((nav: NavKey) => router.push(NAV_ROUTES[nav]), [router]);
  const [chatInitialPaperId, setChatInitialPaperId] = useState<string | null>(null);

  const openReaderForPaper = useCallback(
    (paperId: string) => {
      const p = papers.find((x) => x.id === paperId);
      if (p) {
        selectPaper(p);
        router.push('/library');
      }
    },
    [papers, selectPaper, router]
  );

  const openPaperInReader = useCallback(
    (paper: Paper) => {
      selectPaper(paper);
      router.push('/library');
    },
    [selectPaper, router]
  );

  const openChatForPaper = useCallback(
    (paperId: string) => {
      setChatInitialPaperId(paperId);
      router.push('/chat');
    },
    [router]
  );

  const clearChatSeed = useCallback(() => setChatInitialPaperId(null), []);

  // -------------------------------------------------------------- Shell panels
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSourcePanelCollapsed, setIsSourcePanelCollapsed] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [activeChatSource, setActiveChatSource] = useState<GroundedPassage | null>(null);
  const [unsupportedClaimsCount, setUnsupportedClaimsCount] = useState(0);

  const setSourcePanelCollapsed = useCallback((v: boolean) => setIsSourcePanelCollapsed(v), []);
  const toggleSourcePanel = useCallback(() => setIsSourcePanelCollapsed((prev) => !prev), []);
  const toggleComments = useCallback(() => setIsCommentsOpen((prev) => !prev), []);

  // -------------------------------------------------------------------- Modals
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isOutlineModalOpen, setIsOutlineModalOpen] = useState(false);
  const [isAddByIdentifierOpen, setIsAddByIdentifierOpen] = useState(false);
  const [isBibtexModalOpen, setIsBibtexModalOpen] = useState(false);
  const [bibtexModalTab, setBibtexModalTab] = useState<'import' | 'export'>('import');
  const [isZoteroModalOpen, setIsZoteroModalOpen] = useState(false);
  const [isProviderQuotaModalOpen, setIsProviderQuotaModalOpen] = useState(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [isPluginModalOpen, setIsPluginModalOpen] = useState(false);
  const [searchSeedQuery, setSearchSeedQuery] = useState('');

  const openSearchModal = useCallback((seedQuery?: string) => {
    if (seedQuery !== undefined) setSearchSeedQuery(seedQuery);
    setIsSearchModalOpen(true);
  }, []);
  const openExportModal = useCallback(() => setIsExportModalOpen(true), []);
  const openShortcutsModal = useCallback(() => setIsShortcutsModalOpen(true), []);
  const openProjectModal = useCallback(() => setIsProjectModalOpen(true), []);
  const openPluginsModal = useCallback(() => setIsPluginModalOpen(true), []);
  const openProviderQuotaModal = useCallback(() => setIsProviderQuotaModalOpen(true), []);
  const openZoteroModal = useCallback(() => setIsZoteroModalOpen(true), []);
  const openOutlineModal = useCallback(() => setIsOutlineModalOpen(true), []);
  const openAddByIdentifier = useCallback(() => setIsAddByIdentifierOpen(true), []);
  const openBibtexModal = useCallback(
    (tab: 'import' | 'export' = 'import') => {
      setBibtexModalTab(tab);
      setIsBibtexModalOpen(true);
    },
    []
  );
  const openVersionHistory = useCallback(() => setIsVersionModalOpen(true), []);

  const modals: ModalsState = useMemo(
    () => ({
      isProjectOpen: isProjectModalOpen,
      isShortcutsOpen: isShortcutsModalOpen,
      isSearchOpen: isSearchModalOpen,
      isExportOpen: isExportModalOpen,
      isOutlineOpen: isOutlineModalOpen,
      isAddByIdentifierOpen: isAddByIdentifierOpen,
      isBibtexOpen: isBibtexModalOpen,
      bibtexTab: bibtexModalTab,
      isZoteroOpen: isZoteroModalOpen,
      isProviderQuotaOpen: isProviderQuotaModalOpen,
      isVersionHistoryOpen: isVersionModalOpen,
      isPluginsOpen: isPluginModalOpen,
      searchSeedQuery,
      closeProject: () => setIsProjectModalOpen(false),
      closeShortcuts: () => setIsShortcutsModalOpen(false),
      closeSearch: () => setIsSearchModalOpen(false),
      closeExport: () => setIsExportModalOpen(false),
      closeOutline: () => setIsOutlineModalOpen(false),
      closeAddByIdentifier: () => setIsAddByIdentifierOpen(false),
      closeBibtex: () => setIsBibtexModalOpen(false),
      closeZotero: () => setIsZoteroModalOpen(false),
      closeProviderQuota: () => setIsProviderQuotaModalOpen(false),
      closeVersionHistory: () => setIsVersionModalOpen(false),
      closePlugins: () => setIsPluginModalOpen(false),
    }),
    [
      isProjectModalOpen,
      isShortcutsModalOpen,
      isSearchModalOpen,
      isExportModalOpen,
      isOutlineModalOpen,
      isAddByIdentifierOpen,
      isBibtexModalOpen,
      bibtexModalTab,
      isZoteroModalOpen,
      isProviderQuotaModalOpen,
      isVersionModalOpen,
      isPluginModalOpen,
      searchSeedQuery,
    ]
  );

  // ------------------------------------------------------------ Theme & density
  // The pre-paint script in layout.tsx already applied the stored theme; this
  // effect just brings React state back in sync so toggles work.
  const [isDark, setIsDark] = useState(false);
  const themeInitialized = useRef(false);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem('theme');
    } catch {}
    const dark = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDark(dark);
    themeInitialized.current = true;
  }, []);

  useEffect(() => {
    if (!themeInitialized.current) return;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    try {
      window.localStorage.setItem('theme', isDark ? 'dark' : 'light');
    } catch {}
  }, [isDark]);

  const toggleTheme = useCallback(() => setIsDark((prev) => !prev), []);

  const [densityMode, setDensityMode] = useState<'comfortable' | 'compact'>('comfortable');
  const toggleDensity = useCallback(() => {
    setDensityMode((prev) => {
      const next = prev === 'comfortable' ? 'compact' : 'comfortable';
      document.documentElement.setAttribute('data-density', next);
      return next;
    });
  }, []);

  // --------------------------------------------- AI writing assistance settings
  const [enableGhostText, setEnableGhostText] = useState(true);
  const [providerLatencyTier, setProviderLatencyTier] = useState<'fast' | 'moderate' | 'slow'>(
    'fast'
  );
  const [hourlyCap, setHourlyCap] = useState(100);

  // Persisted locally so every setting survives reloads (opt-in per browser).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('openresearch_ai_writing_prefs');
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        enableGhostText?: boolean;
        providerLatencyTier?: 'fast' | 'moderate' | 'slow';
        hourlyCap?: number;
      };
      if (typeof saved.enableGhostText === 'boolean') setEnableGhostText(saved.enableGhostText);
      if (
        saved.providerLatencyTier === 'fast' ||
        saved.providerLatencyTier === 'moderate' ||
        saved.providerLatencyTier === 'slow'
      ) {
        setProviderLatencyTier(saved.providerLatencyTier);
      }
      if (typeof saved.hourlyCap === 'number') setHourlyCap(saved.hourlyCap);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'openresearch_ai_writing_prefs',
        JSON.stringify({ enableGhostText, providerLatencyTier, hourlyCap })
      );
    } catch {}
  }, [enableGhostText, providerLatencyTier, hourlyCap]);
  const [hourlyUsage, setHourlyUsage] = useState<{ count: number; hourKey: number }>({
    count: 0,
    hourKey: INITIAL_HOUR_KEY,
  });
  const [isEditorFocused, setIsEditorFocused] = useState(false);

  const recordAiRequest = useCallback(() => {
    const hourKey = Math.floor(Date.now() / 3600000);
    setHourlyUsage((u) =>
      u.hourKey === hourKey ? { count: u.count + 1, hourKey } : { count: 1, hourKey }
    );
  }, []);

  // -------------------------------------------------- AI continuation requests
  const [isContinuationOpen, setIsContinuationOpen] = useState(false);
  const [isContinuationLoading, setIsContinuationLoading] = useState(false);
  const [continuationText, setContinuationText] = useState('');
  const [continuationError, setContinuationError] = useState<string | null>(null);
  const [continuationGroundingState, setContinuationGroundingState] =
    useState<GroundingState>('general-knowledge');
  const [continuationSources, setContinuationSources] = useState<GroundedPassage[]>([]);
  const [continuationLatency, setContinuationLatency] = useState<number>(0);
  const [continuationContext, setContinuationContext] = useState<{
    prefix: string;
    paragraph: string;
    section?: string;
  }>({ prefix: '', paragraph: '', section: '' });
  const continuationInserterRef = useRef<((text: string) => boolean) | null>(null);
  const registerContinuationInserter = useCallback((fn: ((text: string) => boolean) | null) => {
    continuationInserterRef.current = fn;
  }, []);

  const runContinuation = useCallback(
    async (prefixText: string, paragraphContext: string, sectionHeading?: string) => {
      if (!activeProject) return;
      setContinuationContext({
        prefix: prefixText,
        paragraph: paragraphContext,
        section: sectionHeading,
      });
      setIsContinuationOpen(true);
      setIsContinuationLoading(true);
      setContinuationText('');
      setContinuationError(null);
      setContinuationSources([]);

      const startTime = performance.now();
      try {
        const res = await api.ai.autocomplete(activeProject.id, {
          prefix_text: prefixText,
          paragraph_context: paragraphContext,
          section_heading: sectionHeading,
          mode: 'continuation',
        });
        const elapsed = Math.round(performance.now() - startTime);

        setContinuationText(res.text || '');
        setContinuationError(null);
        setContinuationGroundingState(
          (res.grounding_state as GroundingState) || 'general-knowledge'
        );
        setContinuationSources((res.source_passages || []).map(toGroundedPassage));
        setContinuationLatency(elapsed);
        recordAiRequest();
      } catch (err) {
        // Preserve raw error for debugging; keep continuationText empty so
        // Accept is disabled and the error is not insertable into the doc.
        const raw = err instanceof Error ? err.message : String(err);
        const is503 = raw.includes('503') || raw.toLowerCase().includes('requires an ai provider');
        setContinuationText('');
        setContinuationError(
          is503
            ? 'No AI provider is available. Configure a cloud provider at Settings > AI Providers, or ensure Tabby/Ollama is running.'
            : 'Failed to generate continuation. Please verify backend connection.'
        );
        setContinuationGroundingState('general-knowledge');
      } finally {
        setIsContinuationLoading(false);
      }
    },
    [activeProject, recordAiRequest]
  );

  const handleAcceptContinuation = useCallback(() => {
    if (!continuationText || continuationError) return;
    // Prefer inline insertion at the current cursor via the editor.
    // This keeps continuation inside the current paragraph instead of
    // appending a new block at the end of the document (bug: "next line").
    const insertedInline = continuationInserterRef.current?.(continuationText) ?? false;
    if (!insertedInline) {
      // Fallback: append at document end (e.g. editor not yet mounted).
      if (!activeDocument) return;
      const current = activeDocument.plain_text || '';
      const inline = continuationText.startsWith(' ') || current.endsWith(' ') || !current
        ? continuationText
        : ` ${continuationText}`;
      // Append inline to last paragraph instead of forcing a new block
      const base = (activeDocument.content_json as Record<string, unknown>) || { type: 'doc', content: [] };
      const content = Array.isArray((base as Record<string, unknown>).content)
        ? [...((base as Record<string, unknown>).content as unknown[])]
        : [];
      if (content.length === 0) {
        content.push({ type: 'paragraph', content: [{ type: 'text', text: inline.trimStart() }] });
      } else {
        const last = content[content.length - 1] as Record<string, unknown>;
        const lastContent = Array.isArray((last as Record<string, unknown>).content)
          ? [...((last as Record<string, unknown>).content as unknown[])]
          : [];
        lastContent.push({ type: 'text', text: inline });
        content[content.length - 1] = { ...last, content: lastContent };
      }
      updateActiveDocument({
        plain_text: current ? `${current}${inline}` : inline.trimStart(),
        content_json: { ...base, type: 'doc', content },
      });
    }
    setIsContinuationOpen(false);
    announce('Continuation accepted and inserted into document.');
  }, [activeDocument, continuationText, continuationError, updateActiveDocument, announce]);

  const dismissContinuation = useCallback(() => {
    setIsContinuationOpen(false);
    // Clear stale payload so a dismissed proposal never leaks into the doc.
    // runContinuation will repopulate on next Ctrl+/ / Regenerate.
    setContinuationText('');
    setContinuationError(null);
    setContinuationSources([]);
    setContinuationLatency(0);
  }, []);

  const regenerateContinuation = useCallback(() => {
    // Regenerate reuses the exact prefix/paragraph that produced the current
    // card so the result is comparable. runContinuation manages loading/error
    // and will replace text/error on completion.
    runContinuation(
      continuationContext.prefix,
      continuationContext.paragraph,
      continuationContext.section
    );
  }, [runContinuation, continuationContext]);

  const continuation: ContinuationState = useMemo(
    () => ({
      isOpen: isContinuationOpen,
      isLoading: isContinuationLoading,
      text: continuationText,
      error: continuationError,
      groundingState: continuationGroundingState,
      sources: continuationSources,
      latency: continuationLatency,
      accept: handleAcceptContinuation,
      regenerate: regenerateContinuation,
      dismiss: dismissContinuation,
    }),
    [
      isContinuationOpen,
      isContinuationLoading,
      continuationText,
      continuationError,
      continuationGroundingState,
      continuationSources,
      continuationLatency,
      handleAcceptContinuation,
      regenerateContinuation,
      dismissContinuation,
    ]
  );

  // ------------------------------------------------------- AI edit review card
  const [isEditReviewOpen, setIsEditReviewOpen] = useState(false);
  const [isEditReviewLoading, setIsEditReviewLoading] = useState(false);
  const [editAction, setEditAction] = useState<AIEditActionType>('clarity');
  const [editOriginalText, setEditOriginalText] = useState('');
  const [editSuggestedText, setEditSuggestedText] = useState('');
  const [editExplanation, setEditExplanation] = useState<string | undefined>(undefined);
  const [editChangesSummary, setEditChangesSummary] = useState<string | undefined>(undefined);
  const [editGroundingState, setEditGroundingState] =
    useState<GroundingState>('general-knowledge');
  const [editSources, setEditSources] = useState<GroundedPassage[]>([]);
  const [editLatency, setEditLatency] = useState<number>(0);

  const runAIEdit = useCallback(
    async (text: string, action: AIEditActionType) => {
      if (!activeProject || !text.trim()) return;
      setEditAction(action);
      setEditOriginalText(text);
      setIsEditReviewOpen(true);
      setIsEditReviewLoading(true);
      setEditSuggestedText('');
      setEditExplanation(undefined);
      setEditChangesSummary(undefined);
      setEditSources([]);

      const startTime = performance.now();
      try {
        const res = await api.ai.edit(activeProject.id, { text, action });
        const elapsed = Math.round(performance.now() - startTime);

        setEditSuggestedText(res.suggested_text || text);
        setEditExplanation(res.explanation);
        setEditChangesSummary(res.changes_summary);
        setEditGroundingState((res.grounding_state as GroundingState) || 'general-knowledge');
        setEditSources((res.sources || []).map(toGroundedPassage));
        setEditLatency(elapsed);
        recordAiRequest();
      } catch (err) {
        setEditSuggestedText(text);
        setEditExplanation('Failed to process edit request.');
        setEditGroundingState('general-knowledge');
      } finally {
        setIsEditReviewLoading(false);
      }
    },
    [activeProject, recordAiRequest]
  );

  const handleAcceptEdit = useCallback(() => {
    if (activeDocument && editOriginalText && editSuggestedText) {
      const current = activeDocument.plain_text || '';
      const nextPlain = current.replace(editOriginalText, editSuggestedText);
      // Patch TipTap JSON so the editor re-renders when focused; fallback to
      // string replacement inside the JSON payload when structure is unknown.
      let nextJson: Record<string, unknown> | undefined;
      try {
        const raw = JSON.stringify(activeDocument.content_json || {});
        if (raw.includes(editOriginalText)) {
          nextJson = JSON.parse(raw.replaceAll(editOriginalText, editSuggestedText)) as Record<string, unknown>;
        }
      } catch {
        // leave nextJson undefined — plain_text is authoritative for persistence
      }
      updateActiveDocument({
        plain_text: nextPlain,
        ...(nextJson ? { content_json: nextJson } : {}),
      });
    }
    setIsEditReviewOpen(false);
    announce('AI Edit accepted and applied to document.');
  }, [activeDocument, editOriginalText, editSuggestedText, updateActiveDocument, announce]);

  const rejectEdit = useCallback(() => setIsEditReviewOpen(false), []);
  const regenerateEdit = useCallback(
    () => runAIEdit(editOriginalText, editAction),
    [runAIEdit, editOriginalText, editAction]
  );

  const editReview: EditReviewState = useMemo(
    () => ({
      isOpen: isEditReviewOpen,
      isLoading: isEditReviewLoading,
      action: editAction,
      originalText: editOriginalText,
      suggestedText: editSuggestedText,
      explanation: editExplanation,
      changesSummary: editChangesSummary,
      groundingState: editGroundingState,
      sources: editSources,
      latency: editLatency,
      accept: handleAcceptEdit,
      reject: rejectEdit,
      regenerate: regenerateEdit,
    }),
    [
      isEditReviewOpen,
      isEditReviewLoading,
      editAction,
      editOriginalText,
      editSuggestedText,
      editExplanation,
      editChangesSummary,
      editGroundingState,
      editSources,
      editLatency,
      handleAcceptEdit,
      rejectEdit,
      regenerateEdit,
    ]
  );

  // ---------------------------------------------------------------- Misc actions
  const insertOutline = useCallback(
    (outlineMarkdownOrJson: unknown, plainText?: string) => {
      if (!activeDocument) return;
      const textToAppend =
        typeof outlineMarkdownOrJson === 'string' ? outlineMarkdownOrJson : plainText || '';
      const currentText = activeDocument.plain_text || '';
      const newText = currentText ? `${currentText}\n\n${textToAppend}` : textToAppend;
      updateActiveDocument({
        plain_text: newText,
        content_json:
          typeof outlineMarkdownOrJson === 'object' && outlineMarkdownOrJson !== null
            ? (outlineMarkdownOrJson as Record<string, unknown>)
            : activeDocument.content_json,
      });
      navigate('documents');
      announce('Structured content inserted into document editor.');
    },
    [activeDocument, updateActiveDocument, navigate, announce]
  );

  const value: WorkspaceContextType = useMemo(
    () => ({
      activeNav,
      navigate,
      openReaderForPaper,
      openPaperInReader,
      openChatForPaper,
      chatInitialPaperId,
      clearChatSeed,

      isSidebarCollapsed,
      setIsSidebarCollapsed,
      isSourcePanelCollapsed,
      setSourcePanelCollapsed,
      toggleSourcePanel,
      isCommentsOpen,
      toggleComments,
      activeChatSource,
      setActiveChatSource,
      unsupportedClaimsCount,
      setUnsupportedClaimsCount,

      modals,
      openSearchModal,
      openExportModal,
      openShortcutsModal,
      openProjectModal,
      openPluginsModal,
      openProviderQuotaModal,
      openZoteroModal,
      openOutlineModal,
      openAddByIdentifier,
      openBibtexModal,
      openVersionHistory,

      isDark,
      toggleTheme,
      densityMode,
      toggleDensity,

      enableGhostText,
      setEnableGhostText,
      providerLatencyTier,
      setProviderLatencyTier,
      hourlyCap,
      setHourlyCap,
      hourlyUsage,
      recordAiRequest,
      isEditorFocused,
      setIsEditorFocused,

      continuation,
      editReview,
      triggerContinuation: runContinuation,
      triggerAIEdit: runAIEdit,
      registerContinuationInserter,

      announce,
      insertOutline,
      srAnnouncement,
    }),
    [
      activeNav,
      navigate,
      openReaderForPaper,
      openPaperInReader,
      openChatForPaper,
      chatInitialPaperId,
      clearChatSeed,
      isSidebarCollapsed,
      isSourcePanelCollapsed,
      setSourcePanelCollapsed,
      toggleSourcePanel,
      isCommentsOpen,
      toggleComments,
      activeChatSource,
      unsupportedClaimsCount,
      modals,
      openSearchModal,
      openExportModal,
      openShortcutsModal,
      openProjectModal,
      openPluginsModal,
      openProviderQuotaModal,
      openZoteroModal,
      openOutlineModal,
      openAddByIdentifier,
      openBibtexModal,
      openVersionHistory,
      isDark,
      toggleTheme,
      densityMode,
      toggleDensity,
      enableGhostText,
      providerLatencyTier,
      hourlyCap,
      hourlyUsage,
      recordAiRequest,
      isEditorFocused,
      continuation,
      editReview,
      runContinuation,
      runAIEdit,
      registerContinuationInserter,
      announce,
      insertOutline,
      srAnnouncement,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = (): WorkspaceContextType => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
};
