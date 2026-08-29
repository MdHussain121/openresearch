'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { usePaper, Paper, PaperAnnotation } from '../../context/PaperContext';
import { api } from '../../lib/api';
import { t } from '../../i18n';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Columns,
  FileText,
  Search,
  Highlighter,
  MessageSquare,
  StickyNote,
  AlertTriangle,
  Table as TableIcon,
  Sigma,
  Sparkles,
  Send,
  Trash2,
  CheckCircle2,
  X,
  ExternalLink,
  BookOpen
} from 'lucide-react';

interface PdfReaderProps {
  paper: Paper;
  onBack: () => void;
  onOpenChat: (paper: Paper) => void;
}

type ViewMode = 'split' | 'pdf' | 'text';
type ActiveTab = 'sections' | 'tables' | 'equations' | 'annotations';

export const PdfReader: React.FC<PdfReaderProps> = ({ paper, onBack, onOpenChat }) => {
  const {
    annotations,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
    askPaperAi,
  } = usePaper();

  // Reader UI States
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [activeTab, setActiveTab] = useState<ActiveTab>('sections');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [inDocQuery, setInDocQuery] = useState<string>('');
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [isSearchClosing, setIsSearchClosing] = useState(false);

  // Text selection & floating toolbar state
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectionRange, setSelectionRange] = useState<{ x: number; y: number } | null>(null);
  const [showNoteEditor, setShowNoteEditor] = useState<boolean>(false);
  const [noteInput, setNoteInput] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState<string>('yellow');

  // Inline AI thread state (UI/UX §4.6)
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [aiCustomQuestion, setAiCustomQuestion] = useState<string>('');
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [activeThreadAnnotation, setActiveThreadAnnotation] = useState<PaperAnnotation | null>(null);

  const readerContainerRef = useRef<HTMLDivElement>(null);

  const metadata = useMemo(() => paper.metadata_json || {}, [paper]);
  // metadata_json comes from external extraction pipelines — never trust its shape.
  const sections = useMemo(
    () => (Array.isArray(metadata.sections) ? metadata.sections : []),
    [metadata]
  );
  const tables = useMemo(
    () => (Array.isArray(metadata.tables) ? metadata.tables : []),
    [metadata]
  );
  const equations = useMemo(
    () => (Array.isArray(metadata.equations) ? metadata.equations : []),
    [metadata]
  );
  const pages = useMemo(
    () => (Array.isArray(metadata.pages) ? metadata.pages : []),
    [metadata]
  );
  const totalPages = Math.max(pages.length, metadata.page_count || 1, 1);
  const isUnverified = paper.extraction_status === 'unverified';

  // Check if paper has a locally uploaded/stored PDF accessible via the backend API
  const hasLocalPdf = useMemo(() => {
    return Boolean(metadata.pdf_path);
  }, [metadata]);

  // Resolve external source URL (e.g. arXiv abstract page or DOI landing page)
  const externalSourceUrl = useMemo(() => {
    return (
      (metadata.url as string) ||
      (metadata.pdf_url as string) ||
      (paper.doi ? `https://doi.org/${paper.doi}` : null)
    );
  }, [metadata, paper.doi]);

  // Determine the type of "no text" situation for better fallback messaging
  const noTextReason = useMemo(() => {
    if (pages.length === 0 && sections.length === 0) {
      // No pages and no sections - likely DOI/arXiv/PMID added without PDF
      return 'identifier_only';
    }
    if (pages.length > 0 && pages.every((p) => !p.text?.trim())) {
      // Pages exist but all empty - scanned/image PDF
      return 'scanned_pdf';
    }
    return 'missing_page_data';
  }, [pages, sections]);

  // Handle Text Selection in Document Reader
  const handleMouseUp = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      // Don't dismiss if interacting with the modal
      if (!showNoteEditor && !showAiModal) {
        setSelectedText('');
        setSelectionRange(null);
      }
      return;
    }

    const text = selection.toString().trim();
    if (text.length > 3) {
      setSelectedText(text);
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelectionRange({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
      });
    }
  };

  const handleApplyHighlight = async (color: string) => {
    if (!selectedText) return;
    await createAnnotation({
      page_number: currentPage,
      selected_text: selectedText,
      highlight_color: color,
    });
    setSelectedText('');
    setSelectionRange(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleSaveNote = async () => {
    if (!selectedText || !noteInput.trim()) return;
    await createAnnotation({
      page_number: currentPage,
      selected_text: selectedText,
      highlight_color: selectedColor,
      note_text: noteInput.trim(),
    });
    setNoteInput('');
    setShowNoteEditor(false);
    setSelectedText('');
    setSelectionRange(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleAskAiPrompt = async (promptType: string, customQ?: string) => {
    if (!selectedText) return;
    setAiLoading(true);
    setAiAnswer(null);
    setAiError(null);
    setShowAiModal(true);

    const res = await askPaperAi({
      selected_text: selectedText,
      page_number: currentPage,
      prompt_type: promptType,
      question: customQ,
    });

    if (res) {
      setAiAnswer(res.answer);
      // Also attach to annotation thread
      const created = await createAnnotation({
        page_number: currentPage,
        selected_text: selectedText,
        highlight_color: 'blue',
        note_text: `AI Query (${promptType}): ${customQ || promptType}`,
      });
      if (created) {
        await updateAnnotation(created.id, {
          ai_thread: [
            { role: 'user', message: customQ || `Ask AI: ${promptType}`, timestamp: new Date().toISOString() },
            { role: 'assistant', message: res.answer, timestamp: new Date().toISOString() },
          ],
        });
      }
    } else {
      setAiError(t('reader.ai.requestFailed'));
    }
    setAiLoading(false);
  };

  // Filter sections/pages by in-document search
  const filteredSections = useMemo(() => {
    if (!inDocQuery.trim()) return sections;
    const q = inDocQuery.toLowerCase();
    return sections.filter(
      (s) => s.title.toLowerCase().includes(q) || s.text.toLowerCase().includes(q)
    );
  }, [sections, inDocQuery]);

  const currentPageData = pages.find((p) => p.page_number === currentPage) || {
    page_number: currentPage,
    text: sections.filter((s) => s.page_number === currentPage).map((s) => `${s.title}\n\n${s.text}`).join('\n\n') ||
      (noTextReason === 'identifier_only'
        ? 'Paper added via identifier (DOI/arXiv/PMID) without PDF upload. No extracted text available. Download from publisher or upload PDF.'
        : noTextReason === 'scanned_pdf'
        ? 'This PDF appears to be scanned or image-based. Text extraction not possible without OCR. View PDF below.'
        : 'No extracted text for this page. Please refer to the PDF render.'),
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-canvas select-text" ref={readerContainerRef}>
      {/* 1. Header Toolbar (Navigation, Page controls, Zoom, Views) */}
      <header className="border-b border-border-default bg-surface px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 z-20">
        {/* Left: Back & Title */}
        <div className="flex items-center space-x-3 overflow-hidden max-w-sm md:max-w-md">
          <button
            onClick={onBack}
            className="p-1.5 rounded border border-border-default bg-sunken hover:bg-surface text-text-primary transition-colors shrink-0"
            title={t('reader.backToLibrary')}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>

          <div className="truncate">
            <h2 className="font-serif font-semibold text-xs md:text-sm text-text-primary truncate" title={paper.title}>
              {paper.title}
            </h2>
            <div className="flex items-center space-x-2 text-[10px] text-text-tertiary">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  !isUnverified ? 'bg-trust-success' : 'bg-trust-warning'
                }`}
              />
              <span>{!isUnverified ? t('trust.verifiedExtraction') : t('trust.unverifiedExtraction')}</span>
              <span>•</span>
              <span>{paper.year || 'n.d.'}</span>
            </div>
          </div>
        </div>

        {/* Center: Page Navigation & Zoom */}
        <div className="flex items-center space-x-2 text-xs">
          {/* Page Controls */}
          <div className="flex items-center space-x-1 px-2 py-1 rounded border border-border-default bg-sunken">
            <button
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              disabled={currentPage <= 1}
              className="p-1 rounded hover:bg-surface disabled:opacity-40 text-text-primary"
              title={t('reader.prevPage')}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <span className="px-1 text-[11px] font-mono text-text-secondary">
              {currentPage} / {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              disabled={currentPage >= totalPages}
              className="p-1 rounded hover:bg-surface disabled:opacity-40 text-text-primary"
              title={t('reader.nextPage')}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Zoom Controls */}
          <div className="hidden sm:flex items-center space-x-1 px-2 py-1 rounded border border-border-default bg-sunken">
            <button
              onClick={() => setZoomLevel((z) => Math.max(z - 15, 60))}
              className="p-1 rounded hover:bg-surface text-text-primary"
              title={t('reader.zoomOut')}
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="px-1 text-[11px] font-mono text-text-secondary">{zoomLevel}%</span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(z + 15, 200))}
              className="p-1 rounded hover:bg-surface text-text-primary"
              title={t('reader.zoomIn')}
            >
              <ZoomIn className="w-3 h-3" />
            </button>
          </div>

          {/* In-Doc Search Trigger */}
          <button
            onClick={() => {
              if (showSearch) {
                setIsSearchClosing(true);
                setTimeout(() => {
                  setShowSearch(false);
                  setIsSearchClosing(false);
                }, 100);
              } else {
                setShowSearch(true);
              }
            }}
            className={`p-1.5 rounded border border-border-default transition-colors ${
              showSearch || isSearchClosing ? 'bg-accent/15 text-accent border-accent/40' : 'bg-sunken hover:bg-surface text-text-secondary'
            }`}
            title="Search in document"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: View Mode Toggle & Chat Link */}
        <div className="flex items-center space-x-2">
          {/* View Mode Switcher (UI/UX §4.6) */}
          <div className="flex items-center p-0.5 rounded border border-border-default bg-sunken text-xs">
            <button
              onClick={() => setViewMode('split')}
              className={`px-2 py-1 rounded flex items-center space-x-1.5 transition-colors ${
                viewMode === 'split' ? 'bg-surface text-accent font-medium shadow-2xs' : 'text-text-secondary hover:text-text-primary'
              }`}
              title={t('reader.viewSplit')}
            >
              <Columns className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('reader.viewSplit')}</span>
            </button>

            <button
              onClick={() => setViewMode('pdf')}
              className={`px-2 py-1 rounded flex items-center space-x-1.5 transition-colors ${
                viewMode === 'pdf' ? 'bg-surface text-accent font-medium shadow-2xs' : 'text-text-secondary hover:text-text-primary'
              }`}
              title={t('reader.viewPdfOnly')}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('reader.viewPdfOnly')}</span>
            </button>

            <button
              onClick={() => setViewMode('text')}
              className={`px-2 py-1 rounded flex items-center space-x-1.5 transition-colors ${
                viewMode === 'text' ? 'bg-surface text-accent font-medium shadow-2xs' : 'text-text-secondary hover:text-text-primary'
              }`}
              title="Accessible Extracted Text (Screen Reader Friendly)"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{t('reader.viewTextOnly')}</span>
            </button>
          </div>

          <button
            onClick={() => onOpenChat(paper)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-accent text-accent-solid-fg text-xs font-medium hover:bg-accent-hover transition-colors shadow-2xs"
            title="Ask AI about this paper"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ask AI</span>
          </button>
        </div>
      </header>

      {/* In-Document Search Bar */}
      <div
        className="border-b border-border-default bg-surface px-6 overflow-hidden transition-[max-height,opacity,padding] duration-150 ease-smooth-out data-[state=closing]:duration-80 data-[state=closing]:ease-in"
        data-state={isSearchClosing ? 'closing' : (showSearch ? 'open' : 'closed')}
        style={{
          maxHeight: showSearch && !isSearchClosing ? '80px' : '0',
          opacity: showSearch && !isSearchClosing ? 1 : 0,
          paddingTop: showSearch && !isSearchClosing ? '8px' : '0',
          paddingBottom: showSearch && !isSearchClosing ? '8px' : '0',
        }}
      >
        <div className="flex items-center justify-between gap-3 text-xs py-2">
          <div className="flex items-center space-x-2 flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-text-tertiary" />
            <input
              type="text"
              autoFocus
              value={inDocQuery}
              onChange={(e) => setInDocQuery(e.target.value)}
              placeholder={t('reader.searchInDoc')}
              className="w-full bg-transparent border-none text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
          </div>
          {inDocQuery && (
            <span className="text-[11px] text-text-tertiary font-mono">
              {filteredSections.length} matching section(s)
            </span>
          )}
          <button onClick={() => {
            setIsSearchClosing(true);
            setTimeout(() => {
              setShowSearch(false);
              setIsSearchClosing(false);
            }, 100);
          }} className="p-1 text-text-tertiary hover:text-text-primary">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Persistent Unverified Warning Banner (UI/UX §4.6) */}
      {isUnverified && (
        <div className="bg-trust-warning/15 border-b border-trust-warning/30 px-4 py-2 flex items-center justify-between text-xs text-trust-warning font-medium">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t('reader.unverifiedBanner')}</span>
          </div>
          {externalSourceUrl && (
            <a
              href={hasLocalPdf ? `/api/v1/papers/${paper.id}/pdf` : externalSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-1 px-2 py-1 text-xs bg-trust-warning/20 border border-trust-warning/40 rounded hover:bg-trust-warning/30 transition-colors"
              title={hasLocalPdf ? 'View original PDF' : 'Open external paper source'}
            >
              <ExternalLink className="w-3 h-3" />
              <span>{hasLocalPdf ? 'View PDF Original' : 'Open Source'}</span>
            </a>
          )}
        </div>
      )}

      {/* 3. Main Reading Surfaces (Split View / PDF / Accessible Text) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: PDF / Document Viewport */}
        {(viewMode === 'split' || viewMode === 'pdf') && (
          <div
            className={`flex-1 overflow-y-auto p-4 md:p-8 flex justify-center bg-sunken/40 ${
              viewMode === 'split' ? 'border-r border-border-default' : ''
            }`}
            onMouseUp={handleMouseUp}
          >
            {hasLocalPdf ? (
              <div className="w-full max-w-3xl h-[calc(100%-4rem)] md:h-[calc(100%-8rem)]">
                <iframe
                  src={`/api/v1/papers/${paper.id}/pdf`}
                  className="w-full h-full border border-border-default rounded-lg shadow-sm bg-white"
                  title={`${paper.title} - PDF`}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              </div>
            ) : (
              <div
                className="w-full max-w-3xl bg-surface border border-border-default rounded-lg shadow-sm p-6 md:p-10 space-y-6 transition-transform origin-top"
                style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center', transition: 'transform 150ms var(--ease-smooth-out)' }}
              >
                {/* Simulated Paper Header */}
                <div className="border-b border-border-default pb-4 space-y-2 text-center">
                  <h1 className="font-serif font-bold text-xl md:text-2xl text-text-primary leading-tight">
                    {paper.title}
                  </h1>
                  <p className="text-xs text-text-secondary">
                    {paper.authors?.map((a) => a.literal || `${a.givenName || ''} ${a.familyName}`.trim()).join(', ')}
                  </p>
                  <div className="flex items-center justify-center space-x-3 text-[11px] text-text-tertiary">
                    {paper.doi && (
                      <span className="font-mono">DOI: {paper.doi}</span>
                    )}
                    {externalSourceUrl && (
                      <a
                        href={externalSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-1 text-accent hover:underline font-sans"
                      >
                        <span>Open Original Source</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Page Content Render */}
                <div className="space-y-4 text-xs md:text-sm leading-relaxed text-text-primary font-serif">
                  {currentPageData.text.split('\n\n').map((para, idx) => (
                    <p key={idx} className="tracking-normal">
                      {para}
                    </p>
                  ))}
                </div>

                {/* Page Footer */}
                <div className="border-t border-border-default/60 pt-4 flex items-center justify-between text-[11px] text-text-tertiary font-sans">
                  <span>OpenResearch Reader • {paper.title.slice(0, 30)}...</span>
                  <span>Page {currentPage} of {totalPages}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Accessible Extracted-Text Mode (screen-reader surface) */}
        {viewMode === 'text' && (
          <div
            className="flex-1 overflow-y-auto px-6 py-8 flex justify-center bg-canvas"
            onMouseUp={handleMouseUp}
            aria-label="Extracted Research Paper Text"
          >
            <article className="w-full max-w-2xl space-y-8 font-serif">
              <header className="border-b border-border-default pb-4 space-y-2">
                <h1 className="text-2xl md:text-3xl font-bold text-text-primary">{paper.title}</h1>
                <p className="text-xs text-text-secondary font-sans">
                  Authors: {paper.authors?.map((a) => a.literal || a.familyName).join(', ')}
                </p>
              </header>

              {filteredSections.map((sec) => (
                <section key={sec.id} className="space-y-2">
                  <h2 className="text-lg font-bold text-accent font-sans border-b border-border-default/40 pb-1">
                    {sec.title}
                  </h2>
                  <div className="text-sm leading-relaxed text-text-primary whitespace-pre-line">
                    {sec.text}
                  </div>
                </section>
              ))}
            </article>
          </div>
        )}

        {/* Right Column: Structured Extracted Content, Tables, Equations, Notes, AI Panel (in Split View) */}
        {viewMode === 'split' && (
          <aside className="w-80 md:w-96 flex flex-col bg-surface overflow-hidden shrink-0 border-l border-border-default">
            {/* Panel Tabs */}
            <div className="flex border-b border-border-default bg-sunken overflow-x-auto scrollbar-none text-xs">
              <button
                onClick={() => setActiveTab('sections')}
                className={`px-3 py-2 border-b-2 font-medium shrink-0 transition-colors ${
                  activeTab === 'sections' ? 'border-accent text-accent bg-surface' : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {t('reader.tabs.sections')}
              </button>
              <button
                onClick={() => setActiveTab('tables')}
                className={`px-3 py-2 border-b-2 font-medium shrink-0 transition-colors ${
                  activeTab === 'tables' ? 'border-accent text-accent bg-surface' : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {t('reader.tabs.tables')} ({tables.length})
              </button>
              <button
                onClick={() => setActiveTab('equations')}
                className={`px-3 py-2 border-b-2 font-medium shrink-0 transition-colors ${
                  activeTab === 'equations' ? 'border-accent text-accent bg-surface' : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {t('reader.tabs.equations')} ({equations.length})
              </button>
              <button
                onClick={() => setActiveTab('annotations')}
                className={`px-3 py-2 border-b-2 font-medium shrink-0 transition-colors ${
                  activeTab === 'annotations' ? 'border-accent text-accent bg-surface' : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {t('reader.tabs.annotations')} ({annotations.length})
              </button>
            </div>

            {/* Tab 1: Sections & Content */}
            {activeTab === 'sections' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
                {filteredSections.length === 0 ? (
                  <div className="py-8 text-center text-text-tertiary">No sections found.</div>
                ) : (
                  filteredSections.map((sec) => (
                    <div
                      key={sec.id}
                      onClick={() => setCurrentPage(sec.page_number || 1)}
                      className="p-2.5 rounded border border-border-default hover:border-accent/50 bg-sunken hover:bg-surface cursor-pointer transition-colors space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-text-primary truncate">{sec.title}</span>
                        <span className="text-[10px] text-text-tertiary bg-surface px-1.5 py-0.5 rounded border border-border-default">
                          p. {sec.page_number || 1}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-secondary line-clamp-2">{sec.text}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 2: Structured Tables (§11a) */}
            {activeTab === 'tables' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                {tables.length === 0 ? (
                  <div className="py-8 text-center text-text-tertiary">{t('reader.tables.noTables')}</div>
                ) : (
                  tables.map((tbl) => (
                    <div key={tbl.id} className="p-3 rounded border border-border-default bg-surface space-y-2 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5 font-semibold text-text-primary">
                          <TableIcon className="w-3.5 h-3.5 text-accent" />
                          <span className="truncate">{tbl.caption}</span>
                        </div>
                        <span className="text-[10px] text-text-tertiary font-mono">Page {tbl.page_number}</span>
                      </div>

                      {/* Structured HTML Table View */}
                      <div className="overflow-x-auto border border-border-default/60 rounded">
                        <table className="w-full text-left text-[11px] divide-y divide-border-default">
                          <thead className="bg-sunken text-text-secondary font-medium">
                            <tr>
                              {tbl.headers.map((h, i) => (
                                <th key={i} className="px-2 py-1 font-semibold">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border-default/50">
                            {tbl.rows.map((r, rIdx) => (
                              <tr key={rIdx} className="hover:bg-sunken/40">
                                {r.map((c, cIdx) => (
                                  <td key={cIdx} className="px-2 py-1 text-text-primary">{c}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 3: Equations (§11a) */}
            {activeTab === 'equations' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                {equations.length === 0 ? (
                  <div className="py-8 text-center text-text-tertiary">{t('reader.equations.noEquations')}</div>
                ) : (
                  equations.map((eq) => (
                    <div key={eq.id} className="p-3 rounded border border-border-default bg-surface space-y-2 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5 font-semibold text-text-primary">
                          <Sigma className="w-3.5 h-3.5 text-accent" />
                          <span>Equation</span>
                        </div>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            eq.is_text_searchable
                              ? 'bg-trust-success/15 text-trust-success border border-trust-success/30'
                              : 'bg-trust-warning/15 text-trust-warning border border-trust-warning/30'
                          }`}
                        >
                          {eq.status_label}
                        </span>
                      </div>

                      <div className="p-2 rounded bg-sunken font-mono text-[11px] text-text-primary break-all">
                        {eq.latex || eq.raw_text}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 4: Annotations & Highlights */}
            {activeTab === 'annotations' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
                {annotations.length === 0 ? (
                  <div className="py-8 text-center text-text-tertiary space-y-1">
                    <StickyNote className="w-8 h-8 mx-auto stroke-1 opacity-60" />
                    <p>{t('reader.note.noNotes')}</p>
                  </div>
                ) : (
                  annotations.map((annot) => (
                    <div
                      key={annot.id}
                      className="p-3 rounded border border-border-default bg-surface hover:border-accent/40 space-y-2 shadow-2xs transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: annot.highlight_color }}
                          />
                          <span className="font-mono text-[10px] text-text-tertiary">
                            p. {annot.page_number}
                          </span>
                        </div>
                        <button
                          onClick={() => deleteAnnotation(annot.id)}
                          className="p-1 text-text-tertiary hover:text-trust-danger"
                          title={t('common.delete')}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="p-1.5 rounded bg-sunken text-[11px] text-text-primary font-serif italic border-l-2 border-accent">
                        &quot;{annot.selected_text}&quot;
                      </div>

                      {annot.note_text && (
                        <p className="text-xs text-text-secondary font-sans">{annot.note_text}</p>
                      )}

                      {annot.ai_thread && annot.ai_thread.length > 0 && (
                        <div className="border-t border-border-default/60 pt-2 space-y-1 text-[11px]">
                          <span className="font-semibold text-accent flex items-center space-x-1">
                            <Sparkles className="w-3 h-3" />
                            <span>AI Thread</span>
                          </span>
                          {annot.ai_thread.map((msg, mIdx) => (
                            <div key={mIdx} className="text-text-secondary">
                              <span className="font-semibold text-text-primary capitalize">{msg.role}: </span>
                              <span>{msg.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* 4. Selection Floating Toolbar (UI/UX §4.6) */}
      {selectedText && selectionRange && !showNoteEditor && !showAiModal && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full mb-2 bg-surface border border-border-default shadow-xl rounded-md p-1.5 flex items-center space-x-1 text-xs animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-150 ease-smooth-out"
          style={{ left: `${selectionRange.x}px`, top: `${selectionRange.y}px`, transitionTimingFunction: 'var(--ease-smooth-out)' }}
        >
          {/* Highlight Colors */}
          <div className="flex items-center space-x-1 pr-1 border-r border-border-default">
            <button
              onClick={() => handleApplyHighlight('yellow')}
              className="w-4 h-4 rounded-full bg-yellow-300 border border-yellow-400 hover:scale-110 active:scale-90 transition-transform duration-150"
              title="Yellow Highlight"
            />
            <button
              onClick={() => handleApplyHighlight('lightgreen')}
              className="w-4 h-4 rounded-full bg-green-300 border border-green-400 hover:scale-110 active:scale-90 transition-transform duration-150"
              title="Green Highlight"
            />
            <button
              onClick={() => handleApplyHighlight('lightblue')}
              className="w-4 h-4 rounded-full bg-blue-300 border border-blue-400 hover:scale-110 active:scale-90 transition-transform duration-150"
              title="Blue Highlight"
            />
            <button
              onClick={() => handleApplyHighlight('pink')}
              className="w-4 h-4 rounded-full bg-pink-300 border border-pink-400 hover:scale-110 active:scale-90 transition-transform duration-150"
              title="Pink Highlight"
            />
          </div>

          {/* Add Note Button */}
          <button
            onClick={() => setShowNoteEditor(true)}
            className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-sunken text-text-primary"
          >
            <StickyNote className="w-3.5 h-3.5 text-accent" />
            <span>{t('reader.selection.note')}</span>
          </button>

          {/* Ask AI Button */}
          <button
            onClick={() => setShowAiModal(true)}
            className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-sunken text-accent font-medium"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t('reader.selection.askAi')}</span>
          </button>
        </div>
      )}

      {/* Note Editor Popover */}
      {showNoteEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg border border-border-default bg-surface shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-serif font-bold text-sm text-text-primary">Add Note to Selection</span>
              <button onClick={() => setShowNoteEditor(false)} className="p-1 text-text-tertiary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2 rounded bg-sunken text-xs font-serif italic text-text-secondary border-l-2 border-accent">
              &quot;{selectedText}&quot;
            </div>

            <textarea
              autoFocus
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder={t('reader.note.placeholder')}
              className="w-full h-24 p-2.5 rounded border border-border-default bg-sunken focus:bg-surface focus:border-accent text-xs text-text-primary focus:outline-none"
            />

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center space-x-1.5">
                {['yellow', 'lightgreen', 'lightblue', 'pink'].map((c) => (
                  <button
                    key={c}
                    onClick={() => setSelectedColor(c)}
                    className={`w-4 h-4 rounded-full border ${selectedColor === c ? 'ring-2 ring-accent' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowNoteEditor(false)}
                  className="px-3 py-1 text-xs rounded border border-border-default hover:bg-sunken text-text-secondary"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveNote}
                  className="px-3.5 py-1 text-xs rounded bg-accent text-accent-solid-fg font-medium hover:bg-accent-hover"
                >
                  {t('reader.note.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Selection-Anchored AI Q&A Modal (UI/UX §4.6) */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border-default bg-surface shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border-default pb-3">
              <div className="flex items-center space-x-2 text-accent font-serif font-bold text-base">
                <Sparkles className="w-4 h-4" />
                <span>{t('reader.ai.title')}</span>
              </div>
              <button onClick={() => setShowAiModal(false)} className="p-1 text-text-tertiary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 rounded bg-sunken text-xs font-serif italic text-text-secondary border-l-2 border-accent max-h-24 overflow-y-auto">
              &quot;{selectedText}&quot;
            </div>

            {/* Quick Action Prompt Chips */}
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                onClick={() => handleAskAiPrompt('explain')}
                className="px-2.5 py-1 rounded border border-border-default bg-sunken hover:bg-surface hover:border-accent text-text-primary font-medium transition-colors"
              >
                {t('reader.ai.explain')}
              </button>
              <button
                onClick={() => handleAskAiPrompt('summarize')}
                className="px-2.5 py-1 rounded border border-border-default bg-sunken hover:bg-surface hover:border-accent text-text-primary font-medium transition-colors"
              >
                {t('reader.ai.summarize')}
              </button>
              <button
                onClick={() => handleAskAiPrompt('findings')}
                className="px-2.5 py-1 rounded border border-border-default bg-sunken hover:bg-surface hover:border-accent text-text-primary font-medium transition-colors"
              >
                {t('reader.ai.findings')}
              </button>
            </div>

            {/* Custom Question Input */}
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={aiCustomQuestion}
                onChange={(e) => setAiCustomQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && aiCustomQuestion.trim()) {
                    handleAskAiPrompt('custom', aiCustomQuestion.trim());
                  }
                }}
                placeholder={t('reader.ai.customPrompt')}
                className="flex-1 px-3 py-1.5 text-xs rounded border border-border-default bg-sunken focus:bg-surface focus:border-accent text-text-primary placeholder:text-text-tertiary focus:outline-none"
              />
              <button
                onClick={() => {
                  if (aiCustomQuestion.trim()) {
                    handleAskAiPrompt('custom', aiCustomQuestion.trim());
                  }
                }}
                className="px-3 py-1.5 text-xs rounded bg-accent text-accent-solid-fg font-medium hover:bg-accent-hover flex items-center space-x-1"
              >
                <Send className="w-3 h-3" />
                <span>{t('reader.ai.askButton')}</span>
              </button>
            </div>

            {/* AI Response Output */}
            {aiLoading && (
              <div className="py-6 flex items-center justify-center space-x-2 text-xs text-accent">
                <Sparkles className="w-4 h-4 animate-spin" />
                <span>{t('reader.ai.answering')}</span>
              </div>
            )}

            {/* AI Request Error */}
            {aiError && !aiLoading && (
              <div className="p-2.5 rounded border border-trust-warning/40 bg-trust-warning/10 text-xs text-trust-warning flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{aiError}</span>
              </div>
            )}

            {aiAnswer && !aiLoading && (
              <div className="p-3 rounded border border-border-default bg-sunken/60 text-xs space-y-2 max-h-48 overflow-y-auto">
                <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-accent">
                  <CheckCircle2 className="w-3.5 h-3.5 text-trust-success" />
                  <span>Source-Grounded Answer</span>
                </div>
                <div className="text-text-primary whitespace-pre-line leading-relaxed font-sans">
                  {aiAnswer}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
