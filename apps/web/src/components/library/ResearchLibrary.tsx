'use client';

import React, { useState, useRef, useCallback } from 'react';
import { usePaper, Paper, PipelineStep } from '../../context/PaperContext';
import { useProject } from '../../context/ProjectContext';
import { t } from '../../i18n';
import { ConfirmDialog } from '../modals/ConfirmDialog';
import { OnlineSearchPanel } from './OnlineSearchPanel';
import { Tooltip, TooltipTrigger, TooltipContent } from '@openresearch/ui';
import { ViewHeader } from '../shell/ViewHeader';
import { copyWithFallback } from '../../lib/clipboard';
import {
  Upload,
  Search,
  BookOpen,
  MessageSquare,
  Quote,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileText,
  X,
  Sparkles,
  ExternalLink,
  Copy,
  Check,
  Globe
} from 'lucide-react';

interface ResearchLibraryProps {
  onOpenPaper: (paper: Paper) => void;
  onOpenChat: (paper: Paper) => void;
  onCitePaper?: (paper: Paper) => void;
  onOpenAddByIdentifier?: () => void;
  onOpenBibtexModal?: (tab?: 'import' | 'export') => void;
  onOpenZoteroModal?: () => void;
}

export const ResearchLibrary: React.FC<ResearchLibraryProps> = ({
  onOpenPaper,
  onOpenChat,
  onCitePaper,
  onOpenAddByIdentifier,
  onOpenBibtexModal,
  onOpenZoteroModal,
}) => {

  const { activeProject } = useProject();
  const {
    papers,
    isLoading,
    searchQuery,
    setSearchQuery,
    uploadProgress,
    uploadPaper,
    deletePaper,
    dismissUploadProgress,
  } = usePaper();

  const [isDragging, setIsDragging] = useState(false);
  const [copiedCiteId, setCopiedCiteId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'library' | 'online'>('library');
  const [dropError, setDropError] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    if (activeTab !== 'library') return;
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (activeTab !== 'library') return;
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        setDropError(null);
        await uploadPaper(file);
      } else {
        setDropError('Please select a valid PDF file.');
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      await uploadPaper(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleCite = async (paper: Paper, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCitePaper) {
      onCitePaper(paper);
    }
    const firstAuthor = paper.authors?.[0]?.familyName || paper.authors?.[0]?.literal || 'Author';
    const citeText = `(${firstAuthor} et al., ${paper.year || 'n.d.'})`;
    const ok = await copyWithFallback(citeText);
    if (ok) {
      setCopiedCiteId(paper.id);
      setTimeout(() => setCopiedCiteId(null), 2000);
    } else {
      setCopyFallback('Copy failed. Please copy manually: ' + citeText);
      setTimeout(() => setCopyFallback(null), 3000);
    }
  };

  const formatAuthors = (paper: Paper): string => {
    if (!paper.authors || paper.authors.length === 0) return 'Unknown Author';
    if (paper.authors.length === 1) {
      return paper.authors[0].literal || paper.authors[0].familyName;
    }
    if (paper.authors.length === 2) {
      const a1 = paper.authors[0].familyName || paper.authors[0].literal;
      const a2 = paper.authors[1].familyName || paper.authors[1].literal;
      return `${a1} & ${a2}`;
    }
    const first = paper.authors[0].familyName || paper.authors[0].literal;
    return `${first} et al.`;
  };

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden bg-canvas relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept=".pdf,application/pdf"
        className="hidden"
      />

      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-accent/10 border-2 border-dashed border-accent/60 flex flex-col items-center justify-center p-6 select-none pointer-events-none animate-in fade-in zoom-in-96 duration-250">
          <Upload className="w-12 h-12 text-accent animate-pulse-subtle mb-3" />
          <h3 className="font-serif font-bold text-lg text-text-primary animate-in fade-in slide-in-from-bottom-1 duration-250" style={{ animationDelay: '40ms' }}>Drop PDF to Upload</h3>
          <p className="text-xs text-text-secondary mt-1 animate-in fade-in duration-250" style={{ animationDelay: '80ms' }}>{t('library.uploadHint')}</p>
        </div>
      )}

      {dropError && (
        <div
          role="alert"
          className="mx-6 mt-3 flex items-start justify-between gap-2 rounded border border-trust-warning/30 bg-trust-warning/10 px-3 py-2 text-xs text-trust-warning"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{dropError}</span>
          </span>
          <button
            onClick={() => setDropError(null)}
            aria-label="Dismiss error"
            className="shrink-0 rounded p-0.5 hover:bg-trust-warning/15"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {copyFallback && (
        <div
          role="alert"
          className="mx-6 mt-3 flex items-start justify-between gap-2 rounded border border-trust-warning/30 bg-trust-warning/10 px-3 py-2 text-xs text-trust-warning"
        >
          <span>{copyFallback}</span>
          <button
            onClick={() => setCopyFallback(null)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 hover:bg-trust-warning/15"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Stepped Progress Indicator Modal (UI/UX §6.1) */}
      {uploadProgress && (
        <div className="border-b border-border-default bg-surface px-6 py-4 shadow-sm z-20 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-accent shrink-0" />
                <span className="font-medium text-xs text-text-primary truncate max-w-xs md:max-w-md">
                  {uploadProgress.filename}
                </span>
                {uploadProgress.isUnverified && (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] bg-trust-warning/15 text-trust-warning border border-trust-warning/30 font-medium">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{t('pipeline.unverifiedWarning')}</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-tertiary">
                {uploadProgress.step === 'ready'
                  ? 'Paper extracted and indexed into your Research Library.'
                  : t('pipeline.processing')}
              </p>
            </div>

            {/* Stepped Progress Stages (UI/UX §6.1) */}
            <div className="flex items-center space-x-2 text-xs">
              {/* Step 1: Upload */}
              <div className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 text-trust-success" />
                <span className="text-text-secondary">{t('pipeline.upload')}</span>
              </div>
              <span className="text-text-tertiary">→</span>

              {/* Step 2: Extracting */}
              <div className="flex items-center space-x-1.5">
                {uploadProgress.step === 'upload' ? (
                  <div className="w-3.5 h-3.5 rounded-full border border-text-tertiary" />
                ) : uploadProgress.step === 'extracting' ? (
                  <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-trust-success" />
                )}
                <span className={uploadProgress.step === 'extracting' ? 'text-accent font-medium' : 'text-text-secondary'}>
                  {t('pipeline.extracting')}
                </span>
              </div>
              <span className="text-text-tertiary">→</span>

              {/* Step 3: OCR (conditional - shows when OCR was triggered) */}
              {uploadProgress.ocrTotalPages && uploadProgress.ocrTotalPages > 0 && (
                <>
                  <div className="flex items-center space-x-1.5">
                    {uploadProgress.step === 'upload' || uploadProgress.step === 'extracting' ? (
                      <div className="w-3.5 h-3.5 rounded-full border border-text-tertiary" />
                    ) : uploadProgress.step === 'ocr' ? (
                      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-trust-success" />
                    )}
                    <span className={uploadProgress.step === 'ocr' ? 'text-accent font-medium' : 'text-text-secondary'}>
                      {t('pipeline.ocr')} {uploadProgress.ocrCurrentPage || 0}/{uploadProgress.ocrTotalPages}
                    </span>
                  </div>
                  <span className="text-text-tertiary">→</span>
                </>
              )}

              {/* Step 4: Embeddings */}
              <div className="flex items-center space-x-1.5">
                {uploadProgress.step === 'upload' || uploadProgress.step === 'extracting' || uploadProgress.step === 'ocr' ? (
                  <div className="w-3.5 h-3.5 rounded-full border border-text-tertiary" />
                ) : uploadProgress.step === 'embeddings' ? (
                  <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-trust-success" />
                )}
                <span className={uploadProgress.step === 'embeddings' ? 'text-accent font-medium' : 'text-text-secondary'}>
                  {t('pipeline.embeddings')}
                </span>
              </div>
              <span className="text-text-tertiary">→</span>

              {/* Step 5: Ready */}
              <div className="flex items-center space-x-1.5">
                {uploadProgress.step === 'ready' ? (
                  <CheckCircle2 className="w-4 h-4 text-trust-success" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-text-tertiary" />
                )}
                <span className={uploadProgress.step === 'ready' ? 'text-trust-success font-medium' : 'text-text-tertiary'}>
                  {t('pipeline.ready')}
                </span>
              </div>

              {uploadProgress.step === 'ready' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={dismissUploadProgress}
                      className="ml-3 p-1 rounded hover:bg-sunken text-text-tertiary hover:text-text-primary"
                      aria-label={t('common.close')}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t('common.close')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Library Top Action Bar */}
      <ViewHeader
        icon={<BookOpen className="w-5 h-5" />}
        title={t('library.title')}
        badge={
          activeTab === 'library' ? (
            <span className="px-2 py-0.5 rounded-full bg-sunken border border-border-default text-xs text-text-secondary">
              {papers.length} {t('library.papersCount')}
            </span>
          ) : undefined
        }
        actions={
          <>
            {/* View Tabs: Your Library / Search Online */}
            <div
              className="flex items-center rounded-md border border-border-default bg-sunken p-0.5"
              role="tablist"
              aria-label="Library view tabs"
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  setActiveTab(activeTab === 'library' ? 'online' : 'library');
                }
              }}
            >
              <button
                role="tab"
                aria-selected={activeTab === 'library'}
                tabIndex={activeTab === 'library' ? 0 : -1}
                onClick={() => setActiveTab('library')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  activeTab === 'library'
                    ? 'bg-surface shadow-2xs text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>{t('library.yourLibraryTab')}</span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'online'}
                tabIndex={activeTab === 'online' ? 0 : -1}
                onClick={() => setActiveTab('online')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  activeTab === 'online'
                    ? 'bg-surface shadow-2xs text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{t('library.online.tab')}</span>
              </button>
            </div>

            {activeTab === 'library' && (
              <>
                {/* Keyword Search Input */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('library.searchPlaceholder')}
                    aria-label={t('library.searchPlaceholder')}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-border-default bg-sunken hover:bg-surface focus:bg-surface focus:border-accent text-text-primary placeholder:text-text-tertiary focus:outline-none transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                      aria-label="Clear search"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {onOpenAddByIdentifier && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onOpenAddByIdentifier}
                        className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border-default bg-surface hover:bg-sunken text-text-primary transition-colors shrink-0"
                      >
                        <Quote className="w-3.5 h-3.5 text-accent" />
                        <span>+ Identifier</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Add paper by DOI / arXiv ID / PMID</TooltipContent>
                  </Tooltip>
                )}

                {onOpenBibtexModal && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onOpenBibtexModal('import')}
                        className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border-default bg-surface hover:bg-sunken text-text-primary transition-colors shrink-0"
                      >
                        <FileText className="w-3.5 h-3.5 text-text-secondary" />
                        <span>BibTeX</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Import or Export BibTeX</TooltipContent>
                  </Tooltip>
                )}

                {onOpenZoteroModal && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onOpenZoteroModal}
                        className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border-default bg-surface hover:bg-sunken text-accent transition-colors shrink-0"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Zotero</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Sync library with Zotero</TooltipContent>
                  </Tooltip>
                )}

                {/* Upload Button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-medium rounded bg-accent text-accent-solid-fg hover:bg-accent-hover transition-[background-color,box-shadow] duration-150 active:scale-[0.97] shadow-2xs shrink-0"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t('library.uploadPdf')}</span>
                </button>
              </>
            )}
          </>
        }
      />

      {/* Content Area */}
      {activeTab === 'online' ? (
        <OnlineSearchPanel />
      ) : (
      <>
      {/* Library Content Area */}
      <div className="flex-1 overflow-y-auto p-6 flex justify-center">
        <div className="w-full max-w-4xl space-y-4">
          {/* Empty State (UI/UX §6.3) */}
          {isLoading ? (
            <div className="space-y-3">
              {[0,1,2].map((i) => (
                <div key={`sk-${i}`} className="rounded-md border border-border-default bg-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 skeleton" style={{ animationDelay: `${i*40}ms` }}>
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-3/4 bg-sunken rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-sunken rounded animate-pulse" />
                    <div className="flex gap-2 pt-1">
                      <div className="h-2 w-16 bg-sunken rounded-full animate-pulse" />
                      <div className="h-2 w-12 bg-sunken rounded-full animate-pulse" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-7 w-16 bg-sunken rounded animate-pulse" />
                    <div className="h-7 w-16 bg-sunken rounded animate-pulse" />
                    <div className="h-7 w-16 bg-sunken rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : papers.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center space-y-4 rounded-lg border border-dashed border-border-default bg-surface/50 p-8 animate-in fade-in zoom-in-95 duration-250">
              <div className="p-4 rounded-full bg-sunken border border-border-default text-text-tertiary">
                <BookOpen className="w-10 h-10 stroke-1" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h3 className="font-serif font-bold text-base text-text-primary">{t('library.emptyTitle')}</h3>
                <p className="text-xs text-text-secondary">{t('library.uploadHint')}</p>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center space-x-2 px-4 py-2 text-xs font-medium rounded bg-accent text-accent-solid-fg hover:bg-accent-hover transition-[background-color,box-shadow] duration-150 active:scale-[0.97] shadow-2xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{t('library.emptyAction')}</span>
              </button>
            </div>
          ) : (
            /* Card-List Layout (UI/UX §3.3) */
            <div className="space-y-3">
              {papers.map((paper, idx) => {
                const isVerified = paper.extraction_status === 'ok';

                return (
                  <div
                    key={paper.id}
                    style={{ animationDelay: `${Math.min(idx * 40, 280)}ms` }}
                    className="group rounded-md border border-border-default bg-surface hover:border-accent/20 p-4 transition-[transform,border-color] duration-150 shadow-2xs hover:shadow-md active:scale-[0.99] flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-slide-in"
                  >
                    {/* Left: Metadata & Trust Indicator */}
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3
                          onClick={() => onOpenPaper(paper)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onOpenPaper(paper);
                            }
                          }}
                          role="link"
                          tabIndex={0}
                          className="font-serif font-semibold text-sm md:text-base text-text-primary hover:text-accent cursor-pointer truncate tracking-tight focus-visible:ring-2 focus-visible:ring-accent rounded"
                          title={paper.title}
                        >
                          {paper.title}
                        </h3>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                        <span>{formatAuthors(paper)}</span>
                        <span>•</span>
                        <span>{paper.year || 'n.d.'}</span>
                        {paper.doi && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-[11px] text-text-tertiary truncate max-w-[180px]">
                              DOI: {paper.doi}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Extraction Status Dot — ALWAYS VISIBLE (UI/UX §3.3) */}
                      <div className="flex items-center space-x-2 pt-0.5">
                        <div
                          className={`flex items-center space-x-1.5 text-[11px] font-medium ${
                            isVerified ? 'text-trust-success' : 'text-trust-warning'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isVerified ? 'bg-trust-success' : 'bg-trust-warning'
                            }`}
                          />
                          <span>
                            {isVerified ? t('trust.verifiedExtraction') : t('trust.unverifiedExtraction')}
                          </span>
                        </div>

                        {paper.metadata_json?.tables && paper.metadata_json.tables.length > 0 && (
                          <span className="text-[10px] text-text-tertiary bg-sunken px-1.5 py-0.2 rounded border border-border-default">
                            {paper.metadata_json.tables.length} tables
                          </span>
                        )}
                        {paper.metadata_json?.equations && paper.metadata_json.equations.length > 0 && (
                          <span className="text-[10px] text-text-tertiary bg-sunken px-1.5 py-0.2 rounded border border-border-default">
                            {paper.metadata_json.equations.length} equations
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Three Fixed Action Buttons in Fixed Order: [Open] [Chat] [Cite] (UI/UX §3.3) */}
                    <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                      {/* 1. Open Button */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onOpenPaper(paper)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border-default bg-sunken hover:bg-surface text-text-primary hover:text-accent transition-[background-color,border-color,color] duration-150 active:scale-[0.97]"
                          >
                            <BookOpen className="w-3.5 h-3.5" />
                            <span>{t('library.open')}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t('library.open')}</TooltipContent>
                      </Tooltip>

                      {/* 2. Chat Button */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onOpenChat(paper)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border-default bg-sunken hover:bg-surface text-text-primary hover:text-accent transition-[background-color,border-color,color] duration-150 active:scale-[0.97]"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>{t('library.chat')}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t('library.chat')}</TooltipContent>
                      </Tooltip>

                      {/* 3. Cite Button */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => handleCite(paper, e)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border-default bg-sunken hover:bg-surface text-text-primary hover:text-accent transition-[background-color,border-color,color] duration-150 active:scale-[0.97]"
                          >
                        {copiedCiteId === paper.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-trust-success" />
                            <span className="text-trust-success">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Quote className="w-3.5 h-3.5" />
                            <span>{t('library.cite')}</span>
                          </>
                        )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t('library.cite')}</TooltipContent>
                      </Tooltip>

                      {/* Delete Button */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDeleteId(paper.id);
                            }}
                            className="p-1.5 rounded border border-border-default hover:border-trust-danger/40 text-text-tertiary hover:text-trust-danger hover:bg-trust-danger/10 transition-[transform,background-color,border-color,color] duration-150 active:scale-90"
                            aria-label={t('library.delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t('library.delete')}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                 );
               })}
             </div>
           )}
         </div>
       </div>
       </>
      )}

      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        title={t('library.delete')}
        description={t('library.deleteConfirm')}
        onConfirm={() => {
          if (pendingDeleteId) {
            deletePaper(pendingDeleteId);
          }
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
};
