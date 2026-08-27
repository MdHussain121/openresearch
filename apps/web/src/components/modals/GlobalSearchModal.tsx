'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useDocument, DocumentItem } from '../../context/DocumentContext';
import { usePaper, Paper } from '../../context/PaperContext';
import { t } from '../../i18n';
import { Search, FileText, BookOpen } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@openresearch/ui';

export type SearchResultItem =
  | { type: 'document'; id: string; title: string; subtitle: string; raw: DocumentItem }
  | { type: 'paper'; id: string; title: string; subtitle: string; raw: Paper };

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPaper?: (paper: Paper) => void;
  onSelectDocument?: () => void;
  initialQuery?: string;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectPaper,
  onSelectDocument,
  initialQuery,
}) => {
  const { documents, setActiveDocument } = useDocument();
  const { papers, selectPaper } = usePaper();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const combinedResults = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase();

    const docItems: SearchResultItem[] = documents
      .filter((d) => !q || d.title.toLowerCase().includes(q) || (d.plain_text && d.plain_text.toLowerCase().includes(q)))
      .map((d) => ({
        type: 'document',
        id: d.id,
        title: d.title || t('document.untitled'),
        subtitle: 'Document',
        raw: d,
      }));

    const paperItems: SearchResultItem[] = papers
      .filter(
        (p) =>
          !q ||
          p.title.toLowerCase().includes(q) ||
          (p.abstract && p.abstract.toLowerCase().includes(q)) ||
          (p.doi && p.doi.toLowerCase().includes(q)) ||
          p.authors?.some((a) => (a.literal || a.familyName).toLowerCase().includes(q))
      )
      .map((p) => ({
        type: 'paper',
        id: p.id,
        title: p.title,
        subtitle: `Research Paper • ${p.authors?.[0]?.familyName || 'Author'} (${p.year || 'n.d.'})`,
        raw: p,
      }));

    return [...docItems, ...paperItems];
  }, [documents, papers, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (isOpen && initialQuery) {
      setQuery(initialQuery);
    }
  }, [isOpen, initialQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < combinedResults.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = combinedResults[selectedIndex];
        if (selected) {
          if (selected.type === 'document') {
            setActiveDocument(selected.raw);
            onSelectDocument?.();
          } else {
            selectPaper(selected.raw);
            onSelectPaper?.(selected.raw);
          }
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, combinedResults, selectedIndex, setActiveDocument, selectPaper, onSelectDocument, onSelectPaper, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl p-0 overflow-hidden top-[25%] translate-y-[-25%] data-[state=open]:animate-none data-[state=closed]:animate-none">
        <DialogTitle className="sr-only">Search Documents and Papers</DialogTitle>
        <DialogDescription className="sr-only">
          Quick search across all your research documents and library papers
        </DialogDescription>

        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3 border-b border-border-default bg-surface">
          <Search className="w-4 h-4 text-text-tertiary mr-3 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('app.searchPlaceholder')}
            aria-label={t('app.searchPlaceholder')}
            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-0"
          />
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 divide-y divide-border-default/50" role="listbox">
          {combinedResults.length === 0 ? (
            <div className="py-8 text-center text-xs text-text-tertiary">
              No matching documents or research papers found.
            </div>
          ) : (
            combinedResults.map((item, idx) => (
              <button
                key={`${item.type}-${item.id}`}
                type="button"
                role="option"
                aria-selected={idx === selectedIndex}
                onClick={() => {
                  if (item.type === 'document') {
                    setActiveDocument(item.raw);
                    onSelectDocument?.();
                  } else {
                    selectPaper(item.raw);
                    onSelectPaper?.(item.raw);
                  }
                  onClose();
                }}
                className={`w-full text-left px-3 py-2 rounded flex items-center justify-between text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  idx === selectedIndex ? 'bg-sunken text-accent font-medium' : 'hover:bg-sunken/60 text-text-primary'
                }`}
              >
                <div className="flex items-center space-x-2.5 overflow-hidden">
                  {item.type === 'document' ? (
                    <FileText className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
                  ) : (
                    <BookOpen className="w-3.5 h-3.5 shrink-0 text-accent" />
                  )}
                  <div className="truncate">
                    <div className="truncate">{item.title}</div>
                    <div className="text-[10px] text-text-tertiary truncate">{item.subtitle}</div>
                  </div>
                </div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wider shrink-0 ml-2 px-1.5 py-0.5 rounded bg-surface border border-border-default">
                  {item.type}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border-default px-4 py-2 bg-sunken flex items-center justify-between text-[11px] text-text-tertiary">
          <span>Navigate with ↑ / ↓ and Enter to open</span>
          <kbd className="font-mono">Esc to close</kbd>
        </div>
      </DialogContent>
    </Dialog>
  );
};
