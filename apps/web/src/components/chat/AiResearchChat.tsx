'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useProject } from '../../context/ProjectContext';
import { usePaper } from '../../context/PaperContext';
import { toGroundedPassage } from '../../context/WorkspaceContext';
import { api } from '../../lib/api';
import { t } from '../../i18n';
import {
  Send,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  FileText,
  BookOpen,
  FolderKanban,
  Globe,
  Loader2,
  ChevronRight,
  ExternalLink,
  CheckSquare,
  Square,
  Info,
  Layers,
  FileCheck2,
  Lightbulb,
  Scale,
  Search,
  Compass,
  Brain,
} from 'lucide-react';

import type { GroundedPassage } from '@openresearch/ai';
import { ViewHeader } from '../shell/ViewHeader';
import { Tabs, TabsList, TabsTrigger } from '@openresearch/ui';
export type { GroundedPassage };

export type ChatMode = 'document' | 'library' | 'project' | 'general';

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  mode?: ChatMode;
  groundingState?: 'source-grounded' | 'ai-inference' | 'general-knowledge';
  sources?: GroundedPassage[];
  trustLegend?: {
    source_grounded_count: number;
    ai_inference_count: number;
    general_knowledge_count: number;
  };
  insufficientEvidence?: boolean;
  timestamp: string;
  /** True while the assistant response is still streaming in. */
  streaming?: boolean;
}

interface AiResearchChatProps {
  initialPaperId?: string | null;
  onSelectSource?: (passage: GroundedPassage) => void;
  onOpenPaperInReader?: (paperId: string, pageNumber: number) => void;
}

export const AiResearchChat: React.FC<AiResearchChatProps> = ({
  initialPaperId,
  onSelectSource,
  onOpenPaperInReader,
}) => {
  const { activeProject } = useProject();
  const { papers } = usePaper();

  // Mode state: Document / Library / Project / General (UI/UX §4.5)
  const [activeMode, setActiveMode] = useState<ChatMode>(initialPaperId ? 'document' : 'project');
  const [selectedPaperId, setSelectedPaperId] = useState<string>(initialPaperId || (papers[0]?.id ?? ''));
  const [selectedLibraryPaperIds, setSelectedLibraryPaperIds] = useState<string[]>(
    papers.slice(0, 3).map((p) => p.id)
  );

  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [isLibraryFilterOpen, setIsLibraryFilterOpen] = useState(false);

  // Transient "Switched to X mode" popup (auto-dismisses)
  const [modeToast, setModeToast] = useState('');
  const modeToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (modeToastTimerRef.current) clearTimeout(modeToastTimerRef.current);
      streamAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (initialPaperId) {
      setSelectedPaperId(initialPaperId);
      setActiveMode('document');
    }
  }, [initialPaperId]);

  useEffect(() => {
    if (papers.length > 0 && !selectedPaperId) {
      setSelectedPaperId(papers[0].id);
    }
  }, [papers, selectedPaperId]);

  // Show a transient popup on mode switch instead of a permanent transcript divider
  const handleModeChange = (newMode: ChatMode) => {
    if (newMode === activeMode) return;

    let toastText = '';
    if (newMode === 'document') toastText = t('chat.systemDividers.switchedToDocument');
    else if (newMode === 'library') toastText = t('chat.systemDividers.switchedToLibrary');
    else if (newMode === 'project') toastText = t('chat.systemDividers.switchedToProject');
    else if (newMode === 'general') toastText = t('chat.systemDividers.switchedToGeneral');

    setModeToast(toastText);
    if (modeToastTimerRef.current) clearTimeout(modeToastTimerRef.current);
    modeToastTimerRef.current = setTimeout(() => setModeToast(''), 2000);

    setActiveMode(newMode);
  };

  const scrollToBottom = () => {
    const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const patchMessage = (id: string, patch: (msg: ChatMessageItem) => ChatMessageItem) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));
  };

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || inputMessage).trim();
    if (!query || isLoading || !activeProject) return;

    const userMsg: ChatMessageItem = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      mode: activeMode,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Placeholder assistant bubble that fills in incrementally as tokens stream.
    const assistantId = `assistant-${Date.now()}`;
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', content: '', thinking: '', mode: activeMode, timestamp: now, streaming: true },
    ]);
    setInputMessage('');
    setIsLoading(true);

    let topSource: GroundedPassage | undefined;

    // Abort any in-flight stream before starting a new one
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;

    try {
      // Build conversation history payload
      const historyPayload = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      await api.chat.sendStream(
        activeProject.id,
        {
          message: query,
          mode: activeMode,
          paper_id: activeMode === 'document' ? selectedPaperId : undefined,
          paper_ids: activeMode === 'library' ? selectedLibraryPaperIds : undefined,
          conversation_history: historyPayload,
        },
        {
          onMeta: (meta) => {
            if (!mountedRef.current) return;
            const sources = meta.sources.map(toGroundedPassage);
            topSource = sources[0];
            patchMessage(assistantId, (msg) => ({
              ...msg,
              mode: meta.mode,
              groundingState: meta.grounding_state,
              sources,
              trustLegend: meta.trust_legend,
            }));
          },
          onThinking: (text) => {
            if (!mountedRef.current) return;
            patchMessage(assistantId, (msg) => ({ ...msg, thinking: (msg.thinking || '') + text }));
          },
          onContent: (text) => {
            if (!mountedRef.current) return;
            patchMessage(assistantId, (msg) => ({ ...msg, content: msg.content + text }));
          },
          onError: (detail) => {
            if (!mountedRef.current) return;
            patchMessage(assistantId, (msg) => ({ ...msg, content: `Error generating research answer: ${detail}` }));
          },
          onDone: (info) => {
            if (!mountedRef.current) return;
            patchMessage(assistantId, (msg) => ({
              ...msg,
              insufficientEvidence: info.insufficient_evidence ?? false,
            }));
          },
        },
        controller.signal,
      );
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      if (!mountedRef.current) return;
      patchMessage(assistantId, (msg) => ({
        ...msg,
        content: `Error generating research answer: ${err instanceof Error ? err.message : 'Server communication failed.'}`,
      }));
    } finally {
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
      if (!mountedRef.current) return;
      patchMessage(assistantId, (msg) => ({ ...msg, streaming: false }));
      setIsLoading(false);
    }

    // If sources returned, auto-select top passage into source panel
    if (topSource && onSelectSource) {
      onSelectSource(topSource);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const toggleLibraryPaper = (paperId: string) => {
    setSelectedLibraryPaperIds((prev) =>
      prev.includes(paperId) ? prev.filter((id) => id !== paperId) : [...prev, paperId]
    );
  };

  const activePaperObj = papers.find((p) => p.id === selectedPaperId);

  return (
    <div className="relative flex-1 flex flex-col h-full bg-canvas overflow-hidden">
      {/* Transient mode-switch popup (auto-dismisses) */}
      {modeToast && (
<div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-40"
          >
            <div className="px-3.5 py-1.5 text-[11px] font-mono font-medium text-text-secondary bg-surface border border-border-default rounded-full shadow-lg animate-in fade-in slide-in-from-top-2 duration-250" style={{ transitionTimingFunction: 'var(--ease-smooth-out)' }}>
            {modeToast}
          </div>
        </div>
      )}

      {/* 1. Header & Persistent 4-Mode Segmented Control (UI/UX §4.5) */}
      <ViewHeader
        icon={<Sparkles className="w-5 h-5" />}
        title={t('chat.title')}
        subtitle={t(`chat.modeDescriptions.${activeMode}`)}
      />
      <div className="border-b border-border-default bg-surface p-3 space-y-0 shrink-0 select-none shadow-2xs">

        {/* Persistent Segmented Control — never a hidden dropdown (UI/UX §4.5) */}
        <Tabs value={activeMode} onValueChange={(v) => handleModeChange(v as ChatMode)}>
          <TabsList className="grid grid-cols-4 gap-1 p-1 rounded-md bg-sunken border border-border-default" aria-label="AI Chat Modes">
            <TabsTrigger
              value="document"
              className="flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded text-xs font-medium transition-[transform,background-color,color] duration-150"
              title={t('chat.modeDescriptions.document')}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{t('chat.modes.document')}</span>
            </TabsTrigger>

            <TabsTrigger
              value="library"
              className="flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded text-xs font-medium transition-[transform,background-color,color] duration-150"
              title={t('chat.modeDescriptions.library')}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>{t('chat.modes.library')}</span>
            </TabsTrigger>

            <TabsTrigger
              value="project"
              className="flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded text-xs font-medium transition-[transform,background-color,color] duration-150"
              title={t('chat.modeDescriptions.project')}
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>{t('chat.modes.project')}</span>
            </TabsTrigger>

            <TabsTrigger
              value="general"
              className="flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded text-xs font-medium transition-[transform,background-color,color] duration-150"
              title={t('chat.modeDescriptions.general')}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{t('chat.modes.general')}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Mode-Specific Sub-Bar */}
        {activeMode === 'document' && (
          <div className="flex items-center space-x-2 text-xs pt-1">
            <span className="text-text-tertiary shrink-0 font-medium">{t('chat.selectPaper')}:</span>
            {papers.length > 0 ? (
              <select
                value={selectedPaperId}
                onChange={(e) => setSelectedPaperId(e.target.value)}
                className="flex-1 px-2 py-1 text-xs rounded border border-border-default bg-sunken text-text-primary truncate focus:outline-none focus:border-accent"
              >
                {papers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.year || 'n.d.'})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-text-tertiary italic">No papers in project yet. Upload a PDF first.</span>
            )}
          </div>
        )}

        {activeMode === 'library' && (
          <div className="space-y-1.5 text-xs pt-1">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary font-medium">
                {selectedLibraryPaperIds.length} {t('chat.papersSelected')}
              </span>
              <button
                onClick={() => setIsLibraryFilterOpen(!isLibraryFilterOpen)}
                className="text-[11px] text-accent hover:underline flex items-center space-x-1"
              >
                <span>{isLibraryFilterOpen ? 'Hide Selection' : 'Change Papers'}</span>
                <ChevronRight className={`w-3 h-3 transition-transform ${isLibraryFilterOpen ? 'rotate-90' : ''}`} />
              </button>
            </div>

            {isLibraryFilterOpen && (
              <div className="p-2 rounded border border-border-default bg-sunken max-h-36 overflow-y-auto space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
                {papers.map((p) => {
                  const isChecked = selectedLibraryPaperIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleLibraryPaper(p.id)}
                      type="button"
                      className="flex items-center space-x-2 cursor-pointer hover:text-accent text-[11px] w-full text-left"
                    >
                      {isChecked ? (
                        <CheckSquare className="w-3.5 h-3.5 text-accent shrink-0" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                      )}
                      <span className="truncate">{p.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeMode === 'project' && (
          <div className="text-[11px] text-text-secondary flex items-center space-x-1.5 pt-0.5">
            <Layers className="w-3.5 h-3.5 text-accent" />
            <span>Grounded across all {papers.length} research papers in current project</span>
          </div>
        )}

        {activeMode === 'general' && (
          <div className="p-2 rounded bg-trust-general/10 border border-trust-general/30 text-trust-general text-xs flex items-center space-x-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="font-medium">{t('chat.generalWarningBanner')}</span>
          </div>
        )}
      </div>

      {/* 2. Messages Thread Scroll Area */}
      <div
        role="log"
        aria-live="polite"
        className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-w-4xl w-full mx-auto"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-4 my-auto">
            <div className="w-12 h-12 rounded-full bg-accent/10 text-accent flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-md">
              <h3 className="font-serif font-bold text-base text-text-primary">{t('chat.emptyState.title')}</h3>
              <p className="text-xs text-text-secondary leading-relaxed">{t('chat.emptyState.description')}</p>
            </div>

            {/* Quick Suggestion Chips */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md pt-2">
              <button
                type="button"
                onClick={() => handleSendMessage(t('chat.chips.summarizeFindings'))}
                className="p-2.5 rounded border border-border-default bg-surface hover:bg-sunken text-left text-xs text-text-primary hover:border-accent transition-[border-color,background-color] duration-150 active:scale-[0.98] flex items-center space-x-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Lightbulb className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>{t('chat.chips.summarizeFindings')}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSendMessage(t('chat.chips.compareMethods'))}
                className="p-2.5 rounded border border-border-default bg-surface hover:bg-sunken text-left text-xs text-text-primary hover:border-accent transition-[border-color,background-color] duration-150 active:scale-[0.98] flex items-center space-x-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Scale className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>{t('chat.chips.compareMethods')}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSendMessage(t('chat.chips.identifyLimitations'))}
                className="p-2.5 rounded border border-border-default bg-surface hover:bg-sunken text-left text-xs text-text-primary hover:border-accent transition-[border-color,background-color] duration-150 active:scale-[0.98] flex items-center space-x-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Search className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                <span>{t('chat.chips.identifyLimitations')}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSendMessage(t('chat.chips.explainArchitecture'))}
                className="p-2.5 rounded border border-border-default bg-surface hover:bg-sunken text-left text-xs text-text-primary hover:border-accent transition-[border-color,background-color] duration-150 active:scale-[0.98] flex items-center space-x-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Compass className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>{t('chat.chips.explainArchitecture')}</span>
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, msgIdx) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-250">
                <div className="max-w-[80%] rounded-lg p-3.5 bg-accent text-accent-solid-fg shadow-2xs space-y-1">
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  <div className="text-[10px] text-accent-solid-fg/70 text-right">{msg.timestamp}</div>
                </div>
              </div>
            );
          }

          // Assistant Message
          return (
            <div key={msg.id} className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-250" style={{ animationDelay: msg.streaming ? '0ms' : `${Math.min(msgIdx * 40, 240)}ms` }}>
              <div className="max-w-[90%] md:max-w-[85%] rounded-lg p-4 bg-surface border border-border-default shadow-2xs space-y-3">
                {/* General Mode Non-Dismissible Warning Banner on message (UI/UX §4.5) */}
                {msg.mode === 'general' && (
                  <div className="p-2 rounded bg-trust-general/10 border border-trust-general/30 text-trust-general text-[11px] font-medium flex items-center space-x-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('chat.generalWarningBanner')}</span>
                  </div>
                )}

                {/* Trust Legend Indicator (UI/UX §5.1, §4.4) */}
                {msg.trustLegend && (
                  <div className="flex items-center space-x-3 text-[11px] text-text-tertiary pb-2 border-b border-border-default/60 font-mono">
                    <div className="flex items-center space-x-1 text-trust-grounded">
                      <span className="w-1.5 h-1.5 rounded-full bg-trust-grounded"></span>
                      <span>{msg.trustLegend.source_grounded_count} grounded</span>
                    </div>
                    {msg.trustLegend.ai_inference_count > 0 && (
                      <div className="flex items-center space-x-1 text-trust-inference">
                        <span className="w-1.5 h-1.5 rounded-full bg-trust-inference"></span>
                        <span>{msg.trustLegend.ai_inference_count} inference ∿</span>
                      </div>
                    )}
                    <div className="flex items-center space-x-1 text-trust-general">
                      <span className="w-1.5 h-1.5 rounded-full bg-trust-general"></span>
                      <span>{msg.trustLegend.general_knowledge_count} general</span>
                    </div>
                  </div>
                )}

                {/* Insufficient Evidence Warning Banner */}
                {msg.insufficientEvidence && (
                  <div className="p-3 rounded border border-warning/40 bg-warning/10 space-y-1.5">
                    <div className="flex items-center space-x-2 text-warning font-semibold text-xs">
                      <AlertTriangle className="w-4 h-4" />
                      <span>{t('chat.insufficientEvidenceTitle')}</span>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      {t('chat.insufficientEvidenceDesc')}
                    </p>
                  </div>
                )}

                {/* Reasoning / thinking trace (only shown for messages that have one) */}
                {msg.thinking && msg.thinking.trim().length > 0 && (
                  <ThinkingBlock text={msg.thinking} streaming={!!msg.streaming} />
                )}

                {/* In-bubble loading state until the first streamed token arrives */}
                {msg.streaming && !msg.content && (!msg.thinking || msg.thinking.length === 0) && (
                  <div className="flex items-center space-x-2 text-xs text-text-secondary py-1 animate-pulse-subtle">
                    <Loader2 className="w-4 h-4 text-accent animate-spin" />
                    <span>{t('chat.thinking')}</span>
                  </div>
                )}

                {/* Answer Content */}
                  {msg.content && (
                  <div className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap font-sans">
                    {msg.content}
                    {msg.streaming && (
                      <span className="inline-block w-1.5 h-3 ml-0.5 align-middle bg-accent animate-pulse-subtle rounded-sm" aria-hidden="true" />
                    )}
                  </div>
                )}

                {/* Cited Sources Cards List (§10, §26) */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="pt-2 border-t border-border-default space-y-2">
                    <div className="flex items-center space-x-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                      <ShieldCheck className="w-3.5 h-3.5 text-trust-grounded" />
                      <span>{t('chat.sourcesUsed')} ({msg.sources.length})</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {msg.sources.map((src, idx) => (
                        <div
                          key={src.chunkId || idx}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectSource && onSelectSource(src)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectSource && onSelectSource(src);
                            }
                          }}
                          className="group p-2.5 rounded border border-border-default bg-sunken hover:bg-surface hover:border-accent cursor-pointer transition-[transform,border-color,background-color] duration-150 space-y-1 w-full text-left"
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-trust-grounded">[{idx + 1}] {src.authors}</span>
                            <span className="text-text-tertiary font-mono">P.{src.pageNumber ?? 1}</span>
                          </div>
                          <p className="text-xs font-medium text-text-primary line-clamp-1 group-hover:text-accent">
                            {src.paperTitle}
                          </p>
                          <p className="text-[11px] text-text-secondary line-clamp-2 italic">
                            &quot;{src.passageText}&quot;
                          </p>
                          {onOpenPaperInReader && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenPaperInReader(src.paperId, src.pageNumber ?? 1);
                              }}
                              className="text-[10px] text-accent hover:underline flex items-center space-x-1 pt-1"
                            >
                              <span>{t('chat.openInReader')}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-[10px] text-text-tertiary text-right">{msg.timestamp}</div>
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Input & Action Bar */}
      <div className="p-3 md:p-4 border-t border-border-default bg-surface shrink-0">
        <div className="max-w-4xl mx-auto space-y-2">
          <div className="relative flex items-end rounded-lg border border-border-default bg-sunken focus-within:border-accent focus-within:bg-surface transition-[border-color,background-color,box-shadow] duration-150 p-2">
            <textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.inputPlaceholder')}
              rows={2}
              aria-label={t('chat.inputPlaceholder')}
              className="flex-1 bg-transparent text-xs text-text-primary resize-none focus:outline-none placeholder:text-text-tertiary leading-relaxed p-1"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!inputMessage.trim() || isLoading}
              className="p-2 rounded-md bg-accent text-accent-solid-fg hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,opacity] duration-150 active:scale-90 shrink-0 ml-2"
              aria-label={t('chat.send')}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-text-tertiary px-1">
            <span className="font-mono">Press Enter to send, Shift+Enter for new line</span>
            <span className="font-mono">Mode: {activeMode.toUpperCase()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Collapsible panel showing the model's reasoning trace. Auto-expands while the
 * response is streaming and auto-collapses once the answer starts arriving;
 * the user can toggle it freely afterwards.
 */
const ThinkingBlock: React.FC<{ text: string; streaming: boolean }> = ({ text, streaming }) => {
  const [open, setOpen] = useState(streaming);
  const wasStreaming = useRef(streaming);

  useEffect(() => {
    if (streaming && !wasStreaming.current) setOpen(true);
    if (!streaming && wasStreaming.current) setOpen(false);
    wasStreaming.current = streaming;
  }, [streaming]);

  return (
    <div className="rounded border border-border-default/70 bg-sunken overflow-hidden">
<button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="w-full flex items-center space-x-1.5 px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:text-accent transition-[transform,color] duration-150 focus-visible:ring-2 focus-visible:ring-accent"
        >
        <Brain className={`w-3.5 h-3.5 shrink-0 ${streaming ? 'text-accent animate-pulse-subtle' : ''}`} />
        <span>{t('chat.thinking')}</span>
        <ChevronRight
          className={`w-3 h-3 ml-auto transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="px-2.5 pb-2 max-h-48 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150">
          <p className="text-[11px] leading-relaxed whitespace-pre-wrap italic text-text-secondary border-l-2 border-border-default pl-2">
            {text}
          </p>
        </div>
      )}
    </div>
  );
};
