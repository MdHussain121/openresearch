'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BibliographicReference } from '@openresearch/citations';
import { Search, Plus, ShieldCheck, AlertTriangle, BookOpen, Hash } from 'lucide-react';

export interface CitationPopoverProps {
  isOpen: boolean;
  coords: { top: number; left: number };
  query: string;
  papers: BibliographicReference[];
  paragraphContext?: string;
  onSelect: (paper: BibliographicReference) => void;
  onClose: () => void;
  onOpenAddByIdentifier?: () => void;
}

export const CitationPopover: React.FC<CitationPopoverProps> = ({
  isOpen,
  coords,
  query,
  papers,
  paragraphContext,
  onSelect,
  onClose,
  onOpenAddByIdentifier,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = 'citation-popover-listbox';

  const position = useMemo(() => {
    if (typeof window === 'undefined') return { top: 0, left: 16 };
    const POPOVER_WIDTH = 360;
    const POPOVER_HEIGHT = 320;
    const GAP = 4;
    const MARGIN = 16;

    let left = Math.max(MARGIN, Math.min(coords.left, window.innerWidth - POPOVER_WIDTH - MARGIN));
    const spaceBelow = window.innerHeight - coords.top - GAP;
    const spaceAbove = coords.top - MARGIN;

    let top: number;
    if (spaceBelow >= POPOVER_HEIGHT) {
      top = coords.top + GAP;
    } else if (spaceAbove >= POPOVER_HEIGHT) {
      top = coords.top - POPOVER_HEIGHT - GAP;
    } else if (spaceBelow >= spaceAbove) {
      top = coords.top + GAP;
    } else {
      top = MARGIN;
    }

    // Clamp within viewport
    if (top < MARGIN) top = MARGIN;
    if (top + POPOVER_HEIGHT > window.innerHeight - MARGIN) {
      top = window.innerHeight - POPOVER_HEIGHT - MARGIN;
    }

    return { top, left };
  }, [coords, isOpen]);

  // Compute live ranking combining query filter and context relevance
  const filteredPapers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!papers || papers.length === 0) return [];

    let scored = papers.map((p) => {
      let score = 0;
      const titleLower = (p.title || '').toLowerCase();
      const authorStr = (p.authors || []).map((a) => `${a.familyName} ${a.givenName || ''}`).join(' ').toLowerCase();
      const yearStr = p.year ? String(p.year) : '';

      if (!q) {
        // When no query is typed, rank by overlap with surrounding paragraph context
        if (paragraphContext) {
          const ctxWords = paragraphContext.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
          for (const w of ctxWords) {
            if (titleLower.includes(w)) score += 2;
            if (authorStr.includes(w)) score += 3;
          }
        }
        return { paper: p, score };
      }

      // Query match scoring
      if (titleLower.startsWith(q)) score += 20;
      else if (titleLower.includes(q)) score += 10;

      if (authorStr.includes(q)) score += 15;
      if (yearStr.includes(q)) score += 5;

      return { paper: p, score };
    });

    if (q) {
      scored = scored.filter((s) => s.score > 0);
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.paper);
  }, [papers, query, paragraphContext]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, filteredPapers.length]);

  // Outside-click dismiss
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, onClose]);

  // Keyboard navigation handler for seamless inline typing
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredPapers.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredPapers.length) % Math.max(1, filteredPapers.length));
      } else if (e.key === 'Enter') {
        if (filteredPapers.length > 0 && filteredPapers[selectedIndex]) {
          e.preventDefault();
          onSelect(filteredPapers[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, filteredPapers, selectedIndex, onSelect, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      role="combobox"
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      aria-controls={listboxId}
      aria-activedescendant={filteredPapers[selectedIndex] ? `citation-option-${filteredPapers[selectedIndex].id}` : undefined}
      tabIndex={-1}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      className="fixed z-50 w-[360px] max-h-[320px] rounded-lg border border-border-default bg-surface shadow-lg flex flex-col overflow-hidden text-xs animate-in fade-in duration-80 ease-smooth-out"
    >
      {/* Header bar */}
      <div className="px-3 py-2 border-b border-border-default/70 bg-sunken flex items-center justify-between">
        <div className="flex items-center space-x-1.5 font-medium text-text-primary">
          <BookOpen className="w-3.5 h-3.5 text-accent" />
          <span>Cite Source</span>
        </div>
        <div className="text-[10px] font-mono text-text-tertiary">
          {query ? `Filter: "${query}"` : 'Context ranked'}
        </div>
      </div>

      {/* Results List */}
      <div
        id={listboxId}
        role="listbox"
        aria-label="Citation results"
        className="flex-1 overflow-y-auto p-1 space-y-0.5 divide-y divide-border-default/30"
      >
        {filteredPapers.length > 0 ? (
          filteredPapers.map((paper, idx) => {
            const isSelected = idx === selectedIndex;
            const firstAuthor = paper.authors?.[0]?.familyName || 'Unknown';
            const authorCount = paper.authors?.length || 0;
            const authorDisplay = authorCount > 1 ? `${firstAuthor} et al.` : firstAuthor;
            const isVerified = paper.extractionStatus === 'ok';

            return (
              <div
                key={paper.id}
                role="option"
                aria-selected={isSelected}
                id={`citation-option-${paper.id}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelect(paper)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`px-2.5 py-2 rounded cursor-pointer transition-[background-color,border-color,color] duration-150 flex flex-col space-y-1 ${
                  isSelected ? 'bg-accent/10 border-l-2 border-accent text-accent' : 'hover:bg-sunken text-text-primary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-xs truncate max-w-[240px]">
                    {authorDisplay} ({paper.year || 'n.d.'})
                  </div>
                  <div className="flex items-center space-x-1">
                    {isVerified ? (
                      <span className="flex items-center space-x-0.5 text-[10px] text-trust-grounded font-medium">
                        <ShieldCheck className="w-3 h-3" />
                        <span>ok</span>
                      </span>
                    ) : (
                      <span className="flex items-center space-x-0.5 text-[10px] text-trust-warning font-medium">
                        <AlertTriangle className="w-3 h-3" />
                        <span>unverified</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-text-secondary truncate font-serif">
                  {paper.title}
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-4 text-center text-text-secondary space-y-2">
            <p className="text-xs">No matching papers in library.</p>
            {onOpenAddByIdentifier && (
              <button
                onClick={onOpenAddByIdentifier}
                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-accent text-white hover:bg-accent/90 text-xs transition-[transform,background-color] duration-150 active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add by DOI / arXiv ID / PMID →</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer shortcut bar */}
      <div className="px-3 py-1.5 border-t border-border-default/70 bg-sunken/60 flex items-center justify-between text-[11px] text-text-tertiary">
        <div className="flex items-center space-x-2">
          <span><kbd className="px-1 py-0.5 rounded bg-surface border border-border-default text-[9px] font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface border border-border-default text-[9px] font-mono">↵</kbd> cite</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface border border-border-default text-[9px] font-mono">esc</kbd> cancel</span>
        </div>
        {onOpenAddByIdentifier && (
          <button
            onClick={onOpenAddByIdentifier}
            className="text-accent hover:underline font-medium text-[11px]"
          >
            + Add identifier
          </button>
        )}
      </div>
    </div>
  );
};
