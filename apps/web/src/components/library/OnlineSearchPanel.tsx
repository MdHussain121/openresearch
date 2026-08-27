'use client';

import React, { useState } from 'react';
import { api, LiteratureResultDTO } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useProject } from '../../context/ProjectContext';
import { usePaper } from '../../context/PaperContext';
import { t } from '../../i18n';
import {
  Search,
  Loader2,
  AlertCircle,
  ExternalLink,
  Plus,
  Check,
  Globe,
  FileText,
  ShieldCheck,
} from 'lucide-react';

const SOURCE_OPTIONS = [
  { key: 'openalex', label: 'OpenAlex' },
  { key: 'crossref', label: 'Crossref' },
  { key: 'arxiv', label: 'arXiv' },
  { key: 'semantic_scholar', label: 'Semantic Scholar' },
] as const;

type SourceKey = (typeof SOURCE_OPTIONS)[number]['key'];

interface OnlineSearchPanelProps {
  className?: string;
}

export const OnlineSearchPanel: React.FC<OnlineSearchPanelProps> = () => {
  const { activeProject } = useProject();
  const { loadPapers } = usePaper();

  const [query, setQuery] = useState('');
  const [selectedSources, setSelectedSources] = useState<Set<SourceKey>>(
    new Set(SOURCE_OPTIONS.map((s) => s.key))
  );
  const [yearStart, setYearStart] = useState('');
  const [yearEnd, setYearEnd] = useState('');
  const [openAccessOnly, setOpenAccessOnly] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Awaited<ReturnType<typeof api.research.search>> | null>(null);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [importedKeys, setImportedKeys] = useState<Record<string, true>>({});
  const [expandedAbstracts, setExpandedAbstracts] = useState<Record<string, boolean>>({});
  const [hasSearched, setHasSearched] = useState(false);

  const toggleSource = (key: SourceKey) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery || isSearching) return;

    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);

    try {
      const result = await api.research.search({
        q: cleanQuery,
        sources: Array.from(selectedSources),
        yearStart: yearStart ? parseInt(yearStart, 10) : undefined,
        yearEnd: yearEnd ? parseInt(yearEnd, 10) : undefined,
        openAccessOnly,
      });
      setOutcome(result);
    } catch (err: unknown) {
      setSearchError(getErrorMessage(err, 'Online search failed — please try again.'));
      setOutcome(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleImport = async (result: LiteratureResultDTO, resultKey: string) => {
    if (!activeProject) return;
    const identifier = result.doi || result.arxiv_id;
    if (!identifier || importingKey) return;

    setImportingKey(resultKey);
    try {
      await api.citations.addByIdentifier(activeProject.id, identifier, result.doi ? 'doi' : 'arxiv');
      await loadPapers();
      setImportedKeys((prev) => ({ ...prev, [resultKey]: true }));
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Failed to add paper to library.'));
    } finally {
      setImportingKey(null);
    }
  };

  const formatAuthors = (result: LiteratureResultDTO): string => {
    if (!result.authors || result.authors.length === 0) return 'Unknown Author';
    const first = result.authors[0]?.familyName || result.authors[0]?.literal || 'Author';
    if (result.authors.length === 1) return first;
    if (result.authors.length === 2) {
      const second = result.authors[1]?.familyName || result.authors[1]?.literal || '';
      return `${first} & ${second}`;
    }
    return `${first} et al.`;
  };

  const toggleAbstract = (key: string) => {
    setExpandedAbstracts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search Form */}
      <div className="border-b border-border-default bg-surface px-6 py-4 shrink-0">
        <div className="max-w-4xl mx-auto space-y-3">
          <form onSubmit={handleSearch} className="flex space-x-2">
            <div className="relative flex-1">
              <Globe className="w-3.5 h-3.5 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('library.online.searchPlaceholder')}
                className="w-full pl-8 pr-3 py-2 text-xs rounded border border-border-default bg-canvas text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              className="px-4 py-2 text-xs font-medium rounded bg-accent text-accent-solid-fg hover:bg-accent-hover disabled:opacity-50 flex items-center space-x-1.5 shadow-2xs transition-[background-color,box-shadow] duration-150 active:scale-[0.97] shrink-0 focus-visible:ring-2 focus-visible:ring-accent"
            >
              {isSearching ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>{isSearching ? t('library.online.searching') : t('library.online.searchButton')}</span>
            </button>
          </form>

          {/* Filters */}
          <div className="flex items-center flex-wrap gap-x-4 gap-y-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {t('library.online.sources')}:
            </span>
            {SOURCE_OPTIONS.map((source) => (
              <label
                key={source.key}
                className="flex items-center space-x-1.5 text-xs text-text-secondary cursor-pointer select-none hover:text-text-primary"
              >
                <input
                  type="checkbox"
                  checked={selectedSources.has(source.key)}
                  onChange={() => toggleSource(source.key)}
                  className="accent-accent w-3.5 h-3.5"
                />
                <span>{source.label}</span>
              </label>
            ))}

            <span className="h-4 w-px bg-border-default" aria-hidden="true" />

            <label className="flex items-center space-x-1.5 text-xs text-text-secondary">
              <span>{t('library.online.yearFrom')}</span>
              <input
                type="number"
                min={1000}
                max={2100}
                value={yearStart}
                onChange={(e) => setYearStart(e.target.value)}
                placeholder="1990"
                className="w-16 px-2 py-1 rounded border border-border-default bg-canvas text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex items-center space-x-1.5 text-xs text-text-secondary">
              <span>{t('library.online.yearTo')}</span>
              <input
                type="number"
                min={1000}
                max={2100}
                value={yearEnd}
                onChange={(e) => setYearEnd(e.target.value)}
                placeholder="2026"
                className="w-16 px-2 py-1 rounded border border-border-default bg-canvas text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>

            <label className="flex items-center space-x-1.5 text-xs text-text-secondary cursor-pointer select-none hover:text-text-primary">
              <input
                type="checkbox"
                checked={openAccessOnly}
                onChange={(e) => setOpenAccessOnly(e.target.checked)}
                className="accent-accent w-3.5 h-3.5"
              />
              <span>{t('library.online.openAccessOnly')}</span>
            </label>
          </div>
          <p className="text-[11px] text-text-tertiary">{t('library.online.description')}</p>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-5">
          {searchError && (
            <div className="p-3 rounded border border-trust-danger/30 bg-trust-danger/10 text-trust-danger flex items-start space-x-2 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{searchError}</span>
            </div>
          )}

          {!outcome && !isSearching && !hasSearched && (
            <div className="py-20 flex flex-col items-center justify-center text-center space-y-4 rounded-lg border border-dashed border-border-default bg-surface/50 p-8">
              <div className="p-4 rounded-full bg-sunken border border-border-default text-text-tertiary">
                <Globe className="w-10 h-10 stroke-1" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h3 className="font-serif font-bold text-base text-text-primary">
                  {t('library.online.emptyTitle')}
                </h3>
              </div>
            </div>
          )}

          {!outcome && hasSearched && !isSearching && !searchError && (
            <p className="text-xs text-text-secondary text-center py-10">{t('library.online.noResults')}</p>
          )}

          {isSearching && (
            <div className="py-8 flex flex-col gap-3">
              {[0,1,2].map((i) => (
                <div key={`sk-${i}`} className="rounded-md border border-border-default bg-surface p-4 space-y-2 skeleton">
                  <div className="h-4 w-3/4 bg-sunken rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-sunken rounded animate-pulse" />
                  <div className="h-3 w-full bg-sunken rounded animate-pulse" />
                </div>
              ))}
              <div className="flex items-center justify-center space-x-2 text-text-tertiary pt-2">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
                <p className="text-xs">{t('library.online.searching')}</p>
              </div>
            </div>
          )}

          {outcome &&
            outcome.sources.map((source, sIdx) => (
              <section key={source.source} className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-250" style={{ animationDelay: `${Math.min(sIdx * 40, 160)}ms` }}>
                <div className="flex items-center space-x-2">
                  <h3 className="font-serif font-bold text-sm text-text-primary">{source.source}</h3>
                  {typeof source.total === 'number' && (
                    <span className="px-2 py-0.5 rounded-full bg-sunken border border-border-default text-[11px] text-text-secondary">
                      {source.total.toLocaleString()}
                    </span>
                  )}
                  {source.status === 'error' && (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] bg-trust-warning/15 text-trust-warning border border-trust-warning/30 font-medium">
                      <AlertCircle className="w-3 h-3" />
                      <span>{source.error}</span>
                    </span>
                  )}
                </div>

                {source.results.map((result, index) => {
                  const resultKey = `${source.source}-${index}`;
                  const isImported = importedKeys[resultKey] === true;
                  const identifier = result.doi || result.arxiv_id;
                  const abstractExpanded = expandedAbstracts[resultKey] === true;

                  return (
                    <article
                      key={resultKey}
                      style={{ animationDelay: `${Math.min(index * 40, 280)}ms` }}
                      className="rounded-md border border-border-default bg-surface hover:shadow-md hover:border-accent/20 p-4 transition-[border-color,box-shadow] duration-150 space-y-2 animate-fade-slide-in"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="font-serif font-semibold text-sm text-text-primary leading-snug tracking-tight">
                          {result.title}
                        </h4>
                        {result.url && (
                          <a
                            href={result.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded border border-border-default text-text-tertiary hover:text-accent hover:border-accent/40 shrink-0 transition-colors"
                            title="Open source page"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                        <span>{formatAuthors(result)}</span>
                        <span>•</span>
                        <span>{result.year || 'n.d.'}</span>
                        {result.venue && (
                          <>
                            <span>•</span>
                            <span className="italic truncate max-w-[220px]">{result.venue}</span>
                          </>
                        )}
                        {typeof result.citation_count === 'number' && (
                          <>
                            <span>•</span>
                            <span>
                              {result.citation_count.toLocaleString()} {t('library.online.citationsSuffix')}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center flex-wrap gap-2">
                        {result.open_access && (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-medium bg-trust-grounded/10 text-trust-grounded border border-trust-grounded/30">
                            <ShieldCheck className="w-3 h-3" />
                            <span>{t('library.online.oaBadge')}</span>
                          </span>
                        )}
                        {result.pdf_url && (
                          <a
                            href={result.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] text-accent border border-accent/30 hover:bg-accent/5 transition-colors"
                          >
                            <FileText className="w-3 h-3" />
                            <span>PDF</span>
                          </a>
                        )}
                        {result.doi && (
                          <span className="font-mono text-[10px] text-text-tertiary truncate max-w-[200px]">
                            DOI: {result.doi}
                          </span>
                        )}
                      </div>

                      {result.abstract && (
                        <div className="space-y-0.5">
                          <p
                            className={`text-[11px] text-text-secondary leading-relaxed ${
                              abstractExpanded ? '' : 'line-clamp-2'
                            }`}
                          >
                            {result.abstract}
                          </p>
                          <button
                            onClick={() => toggleAbstract(resultKey)}
                            className="text-[10px] text-accent hover:underline focus:outline-none"
                          >
                            {abstractExpanded ? t('library.online.showLess') : t('library.online.showMore')}
                          </button>
                        </div>
                      )}

                      <div className="pt-1 flex items-center justify-end border-t border-border-default/60">
                        {identifier ? (
                          <button
                            onClick={() => handleImport(result, resultKey)}
                            disabled={isImported || importingKey === resultKey}
                            className={`mt-1.5 flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded transition-[transform,background-color,box-shadow] duration-150 active:scale-[0.97] shadow-2xs ${
                              isImported
                                ? 'bg-trust-success/10 text-trust-success border border-trust-success/30 cursor-default'
                                : 'bg-accent text-accent-solid-fg hover:bg-accent-hover disabled:opacity-50'
                            }`}
                          >
                            {isImported ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>{t('library.online.added')}</span>
                              </>
                            ) : importingKey === resultKey ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>{t('library.online.adding')}</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5" />
                                <span>{t('library.online.addToLibrary')}</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <span
                            className="mt-1.5 inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded border border-border-default text-text-tertiary cursor-not-allowed"
                            title={t('library.online.noIdentifier')}
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>{t('library.online.noIdentifier')}</span>
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
        </div>
      </div>
    </div>
  );
};
