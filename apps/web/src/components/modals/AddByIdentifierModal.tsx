'use client';

import React, { useState } from 'react';
import { api, ResolvedIdentifierDTO } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useProject } from '../../context/ProjectContext';
import { usePaper } from '../../context/PaperContext';
import { BibliographicReference, Author } from '@openresearch/citations';
import { t } from '../../i18n';
import {
  Search,
  BookOpen,
  ShieldCheck,
  Loader2,
  AlertCircle,
  Quote
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@openresearch/ui';

interface AddByIdentifierModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCitePaper?: (paper: BibliographicReference) => void;
}

export const AddByIdentifierModal: React.FC<AddByIdentifierModalProps> = ({
  isOpen,
  onClose,
  onCitePaper,
}) => {
  const { activeProject } = useProject();
  const { loadPapers } = usePaper();

  const [identifier, setIdentifier] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedMeta, setResolvedMeta] = useState<ResolvedIdentifierDTO | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = identifier.trim();
    if (!clean) return;

    setIsLoading(true);
    setError(null);
    setResolvedMeta(null);

    try {
      const meta = await api.citations.resolveIdentifier(clean, 'auto');
      setResolvedMeta(meta);
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('identifierModal.errorNotFound')));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = async (andCite = false) => {
    if (!identifier) return;
    if (!activeProject) {
      setError(t('identifierModal.noProject'));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const paper = await api.citations.addByIdentifier(activeProject.id, identifier.trim(), 'auto');
      await loadPapers();

      if (andCite && onCitePaper) {
        const ref: BibliographicReference = {
          id: paper.id,
          paperId: paper.id,
          title: paper.title,
          authors: paper.authors || [],
          year: paper.year,
          doi: paper.doi,
          arxivId: paper.arxiv_id,
          extractionStatus: 'ok',
        };
        onCitePaper(ref);
      }

      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to add reference'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg p-0 flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <DialogHeader className="px-5 py-3.5 bg-surface">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-accent" />
            <DialogTitle className="font-serif font-bold text-sm text-text-primary">
              {t('identifierModal.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">Resolve and import paper via DOI, arXiv, or PMID</DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          <p className="text-text-secondary leading-relaxed">
            {t('identifierModal.description')}
          </p>

          <form onSubmit={handleLookup} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="identifier-input" className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                Identifier (DOI / arXiv ID / PMID)
              </label>
              <div className="flex space-x-2">
                <input
                  id="identifier-input"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={t('identifierModal.placeholder')}
                  className="flex-1 px-3 py-2 rounded border border-border-default bg-canvas text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-xs font-mono"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isLoading || !identifier.trim()}
                  className="px-3.5 py-2 rounded bg-accent text-accent-solid-fg font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center space-x-1.5 transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>{isLoading ? t('identifierModal.fetching') : t('identifierModal.fetchMetadata')}</span>
                </button>
              </div>
            </div>
          </form>

          {error && (
            <div className="p-3 rounded border border-trust-danger/30 bg-trust-danger/10 text-trust-danger flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Metadata Preview Card */}
          {resolvedMeta && (
            <div className="p-4 rounded-lg border border-accent/30 bg-sunken space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-accent font-semibold text-[11px] uppercase tracking-wider">
                  <ShieldCheck className="w-4 h-4" />
                  <span>{resolvedMeta.id_type?.toUpperCase()} Reference Preview</span>
                </div>
                {resolvedMeta.extraction_status === 'unresolved' ? (
                  <span className="flex items-center space-x-1 text-[10px] text-trust-danger font-medium px-2 py-0.5 rounded bg-surface border border-trust-danger/30">
                    <AlertCircle className="w-3 h-3" />
                    <span>Provider unreachable — not verified</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1 text-[10px] text-trust-grounded font-medium px-2 py-0.5 rounded bg-surface border border-trust-grounded/30">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Verified metadata</span>
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <h3 className="font-serif font-bold text-sm text-text-primary leading-snug">
                  {resolvedMeta.title || identifier.trim()}
                </h3>
                <p className="text-text-secondary text-xs">
                  {resolvedMeta.authors?.map((a: Author) => `${a.familyName} ${a.givenName || ''}`).join(', ')}
                  {resolvedMeta.year ? ` · (${resolvedMeta.year})` : ''}
                </p>
                {resolvedMeta.journal && (
                  <p className="text-text-tertiary text-[11px] italic">
                    {resolvedMeta.journal}
                    {resolvedMeta.volume ? ` vol. ${resolvedMeta.volume}` : ''}
                    {resolvedMeta.pages ? `, pp. ${resolvedMeta.pages}` : ''}
                  </p>
                )}
              </div>

              {resolvedMeta.abstract && (
                <div className="p-2.5 rounded bg-surface border border-border-default/60 text-text-secondary text-[11px] leading-relaxed max-h-28 overflow-y-auto">
                  {resolvedMeta.abstract}
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end space-x-2 border-t border-border-default/60">
                <button
                  type="button"
                  onClick={() => handleAdd(false)}
                  disabled={isSaving}
                  className="px-3 py-1.5 rounded border border-border-default bg-surface hover:bg-sunken text-text-primary font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {isSaving ? 'Adding...' : t('identifierModal.addToLibrary')}
                </button>
                {onCitePaper && (
                  <button
                    type="button"
                    onClick={() => handleAdd(true)}
                    disabled={isSaving}
                    className="px-3.5 py-1.5 rounded bg-accent text-accent-solid-fg font-medium hover:bg-accent/90 transition-colors flex items-center space-x-1.5 shadow-2xs focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Quote className="w-3.5 h-3.5" />
                    <span>{t('identifierModal.addAndCite')}</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
