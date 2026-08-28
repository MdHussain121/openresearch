'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Check,
  RefreshCw,
  X,
  ArrowRight,
  BookOpen,
  GraduationCap,
  Lightbulb,
  Scissors,
  FileText,
  Search,
  Waves,
  Languages,
  Brain
} from 'lucide-react';
import { AIEditActionType, GroundedPassage, GroundingState } from '@openresearch/ai';

export interface AIEditReviewCardProps {
  isOpen: boolean;
  isLoading: boolean;
  action: AIEditActionType;
  originalText: string;
  suggestedText: string;
  explanation?: string;
  changesSummary?: string;
  groundingState?: GroundingState;
  sources?: GroundedPassage[];
  latencyMs?: number;
  onAccept: () => void;
  onReject: () => void;
  onRegenerate?: () => void;
  onInspectSource?: (paperId: string, pageNumber?: number, passage?: string) => void;
}

const ACTION_LABELS: Record<AIEditActionType, { label: string; icon: React.ReactNode }> = {
  clarity: { label: 'Improve Clarity', icon: <Sparkles className="w-3.5 h-3.5 text-accent" /> },
  academic: { label: 'Make Academic', icon: <GraduationCap className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" /> },
  simplify: { label: 'Simplify Text', icon: <Lightbulb className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> },
  shorten: { label: 'Shorten & Condense', icon: <Scissors className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" /> },
  expand: { label: 'Expand & Elaborate', icon: <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> },
  grammar: { label: 'Fix Grammar & Style', icon: <Search className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" /> },
  flow: { label: 'Improve Flow & Transitions', icon: <Waves className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" /> },
  translate: { label: 'Translate Language', icon: <Languages className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> },
  explain: { label: 'Explain Passage', icon: <Brain className="w-3.5 h-3.5 text-pink-600 dark:text-pink-400" /> },
};

export const AIEditReviewCard: React.FC<AIEditReviewCardProps> = ({
  isOpen,
  isLoading,
  action,
  originalText,
  suggestedText,
  explanation,
  changesSummary,
  groundingState,
  sources = [],
  onAccept,
  onReject,
  onRegenerate,
  onInspectSource,
}) => {
  const [isClosing, setIsClosing] = useState(false);

  const handleReject = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onReject();
    }, 150);
  }, [onReject]);

  if (!isOpen && !isClosing) return null;

  const meta = ACTION_LABELS[action] || { label: action, icon: <Sparkles className="w-3.5 h-3.5 text-accent" /> };
  const isGrounded = groundingState === 'source-grounded' && sources.length > 0;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/5 animate-in fade-in duration-150" aria-hidden="true" />
      <div
        className="fixed bottom-4 right-4 left-4 sm:left-auto sm:bottom-12 sm:right-12 z-50 w-auto sm:w-[460px] sm:max-w-lg rounded-lg border border-border-default bg-surface shadow-2xl overflow-hidden font-sans text-xs animate-in fade-in slide-in-from-bottom-4 duration-250 ease-smooth-out data-[state=closing]:animate-out data-[state=closing]:fade-out data-[state=closing]:slide-out-to-bottom-4 data-[state=closing]:duration-150 will-change-transform data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom-4"
        data-state={isClosing ? 'closing' : 'open'}
      >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-sunken border-b border-border-default">
        <div className="flex items-center space-x-2">
          {meta.icon}
          <span className="font-semibold text-text-primary">{meta.label}</span>
          <span className="px-1.5 py-0.2 rounded bg-surface border border-border-default text-[10px] text-text-secondary font-mono">
            reversible
          </span>
        </div>

        <button
          type="button"
          onClick={handleReject}
          className="p-1 rounded hover:bg-surface text-text-tertiary hover:text-text-primary transition-[transform,background-color,color] duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-accent"
          title="Reject / Close (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body: Reversible Diff (Original -> Suggested) */}
      <div className="p-4 space-y-3 max-h-[340px] overflow-y-auto">
        {isLoading ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-2 text-text-tertiary animate-pulse-subtle">
            <RefreshCw className="w-5 h-5 animate-spin text-accent" />
            <span className="text-[11px]">Synthesizing {meta.label.toLowerCase()}...</span>
          </div>
        ) : (
          <>
            {/* Original vs Suggested Side-by-side or Stacked */}
            <div className="space-y-2">
              {/* Original Box */}
              <div className="rounded border border-border-default/80 bg-sunken/40 p-2.5 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                  Original Text (Preserved)
                </div>
                <p className="font-serif text-[14px] leading-relaxed text-text-secondary line-clamp-4">
                  {originalText}
                </p>
              </div>

              <div className="flex justify-center -my-1 relative z-10">
                <div className="bg-surface border border-border-default rounded-full p-1 text-accent shadow-xs">
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Suggested Box */}
              <div className="rounded border border-accent/40 bg-accent/5 p-3 space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-accent">
                  <span>Suggested Revision</span>
                  {isGrounded && (
                    <span className="flex items-center space-x-1 font-normal lowercase bg-accent/15 px-1.5 py-0.2 rounded text-[10px]">
                      <BookOpen className="w-2.5 h-2.5" />
                      <span>Literature Grounded</span>
                    </span>
                  )}
                </div>
                <p className="font-serif text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap selection:bg-accent/20 font-medium">
                  {suggestedText}
                </p>
              </div>
            </div>

            {/* Explanation & Summary Badge */}
            {(explanation || changesSummary) && (
              <div className="p-2 rounded bg-sunken/60 border border-border-default/60 space-y-1 text-[11px]">
                {explanation && <p className="text-text-primary">{explanation}</p>}
                {changesSummary && <p className="text-text-tertiary text-[10px]">{changesSummary}</p>}
              </div>
            )}

            {/* Grounded Sources */}
            {isGrounded && sources.length > 0 && (
              <div className="flex items-center space-x-1.5 text-[11px] pt-1">
                <span className="text-text-tertiary">Grounding:</span>
                {sources.slice(0, 2).map((src, i) => (
                  <button
                    key={src.chunkId || i}
                    type="button"
                    onClick={() => onInspectSource?.(src.paperId, src.pageNumber, src.passageText)}
                    className="px-1.5 py-0.5 rounded bg-surface hover:bg-sunken border border-border-default text-text-secondary truncate max-w-[150px] transition-colors flex items-center space-x-1 focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <BookOpen className="w-3 h-3 text-accent shrink-0" />
                    <span className="truncate">{src.authors} ({src.year || 'n.d.'})</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Action Footer */}
      <div className="px-3.5 py-2.5 bg-sunken/60 border-t border-border-default flex items-center justify-between">
        <button
          type="button"
          onClick={onRegenerate}
          disabled={isLoading}
          className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded border border-border-default bg-surface hover:bg-sunken text-text-secondary transition-[transform,background-color] duration-150 active:scale-[0.97] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Regenerate</span>
        </button>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleReject}
            className="px-3 py-1.5 rounded hover:bg-sunken text-text-secondary transition-[transform,background-color] duration-150 active:scale-[0.97] font-medium focus-visible:ring-2 focus-visible:ring-accent"
          >
            Reject (Keep Original)
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={isLoading || !suggestedText}
            className="flex items-center space-x-1 px-3 py-1.5 rounded bg-accent text-white hover:bg-accent-hover font-medium transition-[background-color,box-shadow] duration-150 active:scale-[0.97] shadow-2xs disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Accept Revision</span>
          </button>
        </div>
      </div>
    </div>
    </>
  );
};
