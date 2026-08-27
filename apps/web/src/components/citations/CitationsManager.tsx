'use client';

import React, { useState, useMemo } from 'react';
import { t } from '../../i18n';
import { useProject } from '../../context/ProjectContext';
import { useDocument } from '../../context/DocumentContext';
import { usePaper } from '../../context/PaperContext';
import {
  CitationStyle,
  BibliographicReference,
  generateBibliography,
  formatBibliographyEntry
} from '@openresearch/citations';
import {
  Quote,
  Copy,
  Check,
  Download,
  Plus,
  FileCode,
  ShieldCheck,
  AlertTriangle,
  BookOpen,
  ExternalLink,
  Search
} from 'lucide-react';
import { ViewHeader } from '../shell/ViewHeader';

interface CitationsManagerProps {
  onOpenAddByIdentifier: () => void;
  onOpenBibtexModal: (tab?: 'import' | 'export') => void;
  onCitePaper: (paper: BibliographicReference) => void;
  onOpenZoteroModal?: () => void;
}

export const CitationsManager: React.FC<CitationsManagerProps> = ({
  onOpenAddByIdentifier,
  onOpenBibtexModal,
  onCitePaper,
  onOpenZoteroModal,
}) => {
  const { activeProject } = useProject();
  const { activeDocument, citationStyle, setCitationStyle, documentCitations } = useDocument();
  const { papers } = usePaper();

  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState('');

  // Map document citations to BibliographicReference objects
  const citedReferences: BibliographicReference[] = useMemo(() => {
    if (!documentCitations || documentCitations.length === 0) return [];
    const uniquePaperIds = Array.from(new Set(documentCitations.map((c) => c.paperId)));

    return uniquePaperIds
      .map((pid) => {
        const p = papers.find((paper) => paper.id === pid);
        if (!p) return null;
        return {
          id: p.id,
          paperId: p.id,
          title: p.title,
          authors: p.authors || [{ familyName: 'Unknown' }],
          year: p.year,
          doi: p.doi,
          arxivId: p.arxiv_id,
          pmid: p.pmid,
          journal: p.metadata_json?.journal,
          volume: p.metadata_json?.volume,
          issue: p.metadata_json?.issue,
          pages: typeof p.metadata_json?.pages === 'string' ? p.metadata_json.pages : undefined,
          publisher: p.metadata_json?.publisher,
          abstract: p.abstract,
          extractionStatus: p.extraction_status || 'ok',
        } as BibliographicReference;
      })
      .filter(Boolean) as BibliographicReference[];
  }, [documentCitations, papers]);


  // Formatted bibliography list
  const formattedBibliography = useMemo(() => {
    return generateBibliography(citedReferences, citationStyle);
  }, [citedReferences, citationStyle]);

  const handleCopyAll = () => {
    if (formattedBibliography.length === 0) return;
    const text = formattedBibliography.map((f) => f.bibliographyEntry).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopySingle = (refId: string, entryText: string) => {
    navigator.clipboard.writeText(entryText);
    setCopiedId(refId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredLibraryPapers = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    if (!q) return papers;
    return papers.filter((p) => {
      const t = (p.title || '').toLowerCase();
      const a = (p.authors || []).map((x) => `${x.familyName} ${x.givenName || ''}`).join(' ').toLowerCase();
      return t.includes(q) || a.includes(q) || (p.doi && p.doi.toLowerCase().includes(q));
    });
  }, [papers, librarySearch]);

  const styleOptions: Array<{ id: CitationStyle; label: string }> = [
    { id: 'apa', label: t('citations.styles.apa') },
    { id: 'mla', label: t('citations.styles.mla') },
    { id: 'chicago', label: t('citations.styles.chicago') },
    { id: 'chicago-notes', label: t('citations.styles.chicagoNotes') },
    { id: 'ieee', label: t('citations.styles.ieee') },
    { id: 'harvard', label: t('citations.styles.harvard') },
    { id: 'vancouver', label: t('citations.styles.vancouver') },
    { id: 'nature', label: t('citations.styles.nature') },
    { id: 'science', label: t('citations.styles.science') },
    { id: 'acm', label: t('citations.styles.acm') },
    { id: 'acs', label: t('citations.styles.acs') },
    { id: 'turabian', label: t('citations.styles.turabian') },
    { id: 'ama', label: t('citations.styles.ama') },
    { id: 'nlm', label: t('citations.styles.nlm') },
    { id: 'cse', label: t('citations.styles.cse') },
    { id: 'apsa', label: t('citations.styles.apsa') },
    { id: 'asa', label: t('citations.styles.asa') },
    { id: 'aaa', label: t('citations.styles.aaa') },
    { id: 'mhra', label: t('citations.styles.mhra') },
    { id: 'oxford', label: t('citations.styles.oxford') },
    { id: 'oscola', label: t('citations.styles.oscola') },
    { id: 'bluebook', label: t('citations.styles.bluebook') },
    { id: 'abnt', label: t('citations.styles.abnt') },
    { id: 'iso690', label: t('citations.styles.iso690') },
    { id: 'gbt7714', label: t('citations.styles.gbt7714') },
    { id: 'cell', label: t('citations.styles.cell') },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-canvas">
      {/* Top Header & Quick Actions */}
      <ViewHeader
        icon={<Quote className="w-5 h-5" />}
        title={t('citations.title')}
        subtitle={t('citations.subtitle')}
        actions={
          <>
            {/* Style Selector Dropdown */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded border border-border-default bg-surface text-xs shadow-2xs">
              <span className="font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                {t('citations.style')}:
              </span>
              <select
                value={citationStyle}
                onChange={(e) => setCitationStyle(e.target.value as CitationStyle)}
                className="bg-transparent text-text-primary font-medium focus:outline-none cursor-pointer"
              >
                {styleOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={onOpenAddByIdentifier}
              className="px-3 py-1.5 rounded bg-accent text-accent-solid-fg font-medium hover:bg-accent/90 flex items-center space-x-1.5 text-xs transition-colors shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('citations.addByIdentifier')}</span>
            </button>

            <button
              onClick={() => onOpenBibtexModal('import')}
              className="px-3 py-1.5 rounded border border-border-default bg-surface hover:bg-sunken text-text-primary font-medium flex items-center space-x-1.5 text-xs transition-colors"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>{t('citations.importBibtex')}</span>
            </button>

            {onOpenZoteroModal && (
              <button
                onClick={onOpenZoteroModal}
                className="px-3 py-1.5 rounded border border-border-default bg-surface hover:bg-sunken text-accent font-medium flex items-center space-x-1.5 text-xs transition-colors shadow-2xs"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Sync Zotero</span>
              </button>
            )}

            <button
              onClick={() => onOpenBibtexModal('export')}
              className="px-3 py-1.5 rounded border border-border-default bg-surface hover:bg-sunken text-text-primary font-medium flex items-center space-x-1.5 text-xs transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('citations.exportBibtex')}</span>
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">

      {/* Main Section 1: Active Document Bibliography */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-accent" />
            <h2 className="font-serif font-bold text-lg text-text-primary">
              {t('citations.bibliography')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-accent font-mono font-medium">
              {citedReferences.length} cited
            </span>
          </div>

          {formattedBibliography.length > 0 && (
            <button
              onClick={handleCopyAll}
              className="px-3 py-1.5 rounded border border-border-default bg-surface hover:bg-sunken text-text-primary font-medium flex items-center space-x-1.5 text-xs transition-colors shadow-2xs"
            >
              {copiedAll ? <Check className="w-3.5 h-3.5 text-trust-grounded" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedAll ? t('citations.copied') : t('citations.copyBibliography')}</span>
            </button>
          )}
        </div>

        {formattedBibliography.length > 0 ? (
          <div className="p-5 rounded-lg border border-border-default bg-surface shadow-2xs space-y-4 divide-y divide-border-default/40">
            {formattedBibliography.map((item, idx) => (
              <div key={item.referenceId} className={`pt-3 first:pt-0 flex items-start justify-between gap-4 group`}>
                <div className="space-y-1 flex-1">
                  <div className="flex items-center space-x-2 text-[11px] text-text-tertiary font-mono">
                    <span className="font-bold text-accent">{item.inlineMarker}</span>
                    <span>•</span>
                    <span className="flex items-center space-x-1 text-trust-grounded">
                      <ShieldCheck className="w-3 h-3" />
                      <span>{item.reference.extractionStatus}</span>
                    </span>
                  </div>
                  <p className="text-xs text-text-primary leading-relaxed font-serif pl-2 border-l-2 border-accent/40">
                    {item.bibliographyEntry}
                  </p>
                </div>

                <button
                  onClick={() => handleCopySingle(item.referenceId, item.bibliographyEntry)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-sunken text-text-tertiary hover:text-text-primary transition-[opacity,background-color,color]"
                  title="Copy reference entry"
                >
                  {copiedId === item.referenceId ? (
                    <Check className="w-3.5 h-3.5 text-trust-grounded" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 rounded-lg border border-dashed border-border-default bg-surface text-center space-y-2">
            <Quote className="w-8 h-8 mx-auto text-text-tertiary opacity-40" />
            <h3 className="font-semibold text-text-primary text-xs">{t('citations.noCitationsInDoc')}</h3>
            <p className="text-text-secondary text-[11px] max-w-md mx-auto">
              Type <kbd className="px-1.5 py-0.5 rounded bg-sunken border border-border-default font-mono">@</kbd> inside the document editor to search and insert source-grounded citations.
            </p>
          </div>
        )}
      </div>

      {/* Main Section 2: Project Library Papers Repository */}
      <div className="space-y-4 pt-4 border-t border-border-default">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center space-x-2">
            <h2 className="font-serif font-bold text-lg text-text-primary">
              {t('citations.projectReferences')}
            </h2>
            <span className="text-xs text-text-tertiary font-mono">
              ({papers.length} total)
            </span>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-text-tertiary" />
            <input
              type="text"
              value={librarySearch}
              onChange={(e) => setLibrarySearch(e.target.value)}
              placeholder="Filter library sources..."
              className="w-full pl-8 pr-3 py-1.5 rounded border border-border-default bg-surface text-xs text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredLibraryPapers.map((paper) => {
            const isCited = documentCitations.some((c) => c.paperId === paper.id);
            const firstAuthor = paper.authors?.[0]?.familyName || 'Unknown';
            const authorCount = paper.authors?.length || 0;
            const authorDisplay = authorCount > 1 ? `${firstAuthor} et al.` : firstAuthor;
            const isVerified = paper.extraction_status === 'ok';

            return (
              <div
                key={paper.id}
                className="p-3.5 rounded-lg border border-border-default bg-surface hover:border-accent/50 transition-colors flex flex-col justify-between space-y-2 shadow-2xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-text-secondary truncate max-w-[200px]">
                      {authorDisplay} ({paper.year || 'n.d.'})
                    </span>
                    <span
                      className={`flex items-center space-x-1 text-[10px] font-medium px-1.5 py-0.2 rounded border ${
                        isVerified
                          ? 'border-trust-grounded/30 bg-trust-grounded/10 text-trust-grounded'
                          : 'border-trust-warning/30 bg-trust-warning/10 text-trust-warning'
                      }`}
                    >
                      {isVerified ? <ShieldCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                      <span>{isVerified ? 'verified' : 'unverified'}</span>
                    </span>
                  </div>

                  <h4 className="font-serif font-bold text-xs text-text-primary leading-snug line-clamp-2">
                    {paper.title}
                  </h4>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border-default/40 text-[11px]">
                  {isCited ? (
                    <span className="text-trust-grounded font-medium flex items-center space-x-1 text-[11px]">
                      <Check className="w-3 h-3" />
                      <span>Cited in document</span>
                    </span>
                  ) : (
                    <span className="text-text-tertiary">Not cited yet</span>
                  )}

                  <button
                    onClick={() => {
                      onCitePaper({
                        id: paper.id,
                        paperId: paper.id,
                        title: paper.title,
                        authors: paper.authors || [],
                        year: paper.year,
                        doi: paper.doi,
                        extractionStatus: isVerified ? 'ok' : 'unverified',
                      });
                    }}
                    className="px-2.5 py-1 rounded bg-sunken hover:bg-accent hover:text-accent-solid-fg border border-border-default text-text-primary font-medium transition-colors flex items-center space-x-1 text-[11px]"
                  >
                    <Quote className="w-3 h-3" />
                    <span>Cite</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
};
