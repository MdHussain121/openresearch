'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Check, RefreshCw, X, BookOpen, Clock, AlertTriangle } from 'lucide-react';
import { GroundedPassage, GroundingState } from '@openresearch/ai';

export interface AIContinuationCardProps {
  isOpen: boolean;
  isLoading: boolean;
  continuationText: string;
  error?: string | null;
  groundingState: GroundingState;
  sources: GroundedPassage[];
  latencyMs?: number;
  onAccept: () => void;
  onRegenerate: () => void;
  onDismiss: () => void;
  onInspectSource?: (paperId: string, pageNumber?: number, passage?: string) => void;
}

export const AIContinuationCard: React.FC<AIContinuationCardProps> = ({
  isOpen,
  isLoading,
  continuationText,
  error,
  groundingState,
  sources,
  latencyMs,
  onAccept,
  onRegenerate,
  onDismiss,
  onInspectSource,
}) => {
  const [isClosing, setIsClosing] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsClosing(true);
    // Wait for exit animation (250ms enter, 150ms exit)
    setTimeout(() => {
      setIsClosing(false);
      onDismiss();
    }, 150);
  }, [onDismiss]);

  // Esc should dismiss the card even when focus stays in the editor
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleDismiss]);

  if (!isOpen && !isClosing) return null;

  const isGrounded = groundingState === 'source-grounded' && sources && sources.length > 0;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/5 animate-in fade-in duration-150" aria-hidden="true" />
      <div
        className="fixed bottom-4 right-4 left-4 sm:left-auto sm:bottom-12 sm:right-12 z-50 w-auto sm:w-[420px] sm:max-w-md rounded-lg border border-border-default bg-surface shadow-xl overflow-hidden font-sans text-xs animate-in fade-in slide-in-from-bottom-4 duration-250 ease-smooth-out data-[state=closing]:animate-out data-[state=closing]:fade-out data-[state=closing]:slide-out-to-bottom-4 data-[state=closing]:duration-150 will-change-transform data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom-4"
        data-state={isClosing ? 'closing' : 'open'}
      >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-sunken border-b border-border-default">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded bg-accent/15 text-accent">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-text-primary">AI Paragraph Continuation</span>
          <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border-default font-mono text-[10px] text-text-tertiary">
            Ctrl+/
          </kbd>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded hover:bg-surface text-text-tertiary hover:text-text-primary transition-[background-color,color] duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-accent"
          title="Dismiss (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body Content */}
      <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto">
        {isLoading ? (
          <div className="py-6 flex flex-col items-center justify-center space-y-2 text-text-tertiary">
            <RefreshCw className="w-5 h-5 animate-spin text-accent" />
            <span className="text-[11px]">Synthesizing literature-grounded continuation...</span>
          </div>
        ) : error ? (
          <div className="py-3 flex items-start space-x-2 rounded border border-trust-warning/30 bg-trust-warning/10 px-3 py-2 text-[12px] text-text-primary">
            <AlertTriangle className="w-4 h-4 text-trust-warning shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : (
          <>
            {/* Continuation Text */}
            <p className="font-serif text-[15px] leading-[1.6] text-text-primary whitespace-pre-wrap selection:bg-accent/15">
              {continuationText || 'No continuation generated.'}
            </p>

            {/* Grounding & Source Badges */}
            <div className="pt-2 border-t border-border-default/60 flex flex-wrap items-center gap-1.5 text-[11px]">
              {isGrounded ? (
                <div className="flex items-center space-x-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium border border-accent/30 flex items-center space-x-1">
                    <BookOpen className="w-3 h-3" />
                    <span>Source Grounded ({sources.length})</span>
                  </span>
                  {sources.slice(0, 2).map((src, i) => (
                    <button
                      key={src.chunkId || i}
                      type="button"
                      onClick={() => onInspectSource?.(src.paperId, src.pageNumber, src.passageText)}
                      className="px-1.5 py-0.5 rounded bg-sunken hover:bg-surface border border-border-default text-text-secondary truncate max-w-[140px] transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                      title={`${src.paperTitle} (P.${src.pageNumber || 1}) - Click to inspect`}
                    >
                      {src.authors} ({src.year || 'n.d.'})
                    </button>
                  ))}
                </div>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-sunken text-text-tertiary border border-border-default">
                  General AI Synthesis
                </span>
              )}

              {latencyMs && (
                <span className="ml-auto text-text-tertiary font-mono text-[10px] flex items-center space-x-1">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{latencyMs}ms</span>
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Action Footer Bar */}
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
            onClick={handleDismiss}
            className="px-3 py-1.5 rounded hover:bg-sunken text-text-secondary transition-[transform,background-color] duration-150 active:scale-[0.97] font-medium focus-visible:ring-2 focus-visible:ring-accent"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={isLoading || !continuationText || !!error}
            className="flex items-center space-x-1 px-3 py-1.5 rounded bg-accent text-white hover:bg-accent-hover font-medium transition-[background-color,box-shadow] duration-150 active:scale-[0.97] shadow-2xs disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Accept &amp; Insert</span>
          </button>
        </div>
      </div>
    </div>
    </>
  );
};
