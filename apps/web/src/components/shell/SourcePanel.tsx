'use client';

import React, { useState, useMemo } from 'react';
import { t } from '../../i18n';
import { 
  ChevronRight, 
  ChevronLeft, 
  Quote, 
  ShieldCheck, 
  Info, 
  ExternalLink, 
  BookOpen, 
  Copy, 
  Check, 
  Download, 
  AlertTriangle
} from 'lucide-react';
import { GroundedPassage } from '../chat/AiResearchChat';
import { useDocument } from '../../context/DocumentContext';
import { usePaper } from '../../context/PaperContext';
import { copyWithFallback } from '../../lib/clipboard';
import {
  CitationStyle,
  BibliographicReference,
  generateBibliography
} from '@openresearch/citations';
import { ClaimVerificationInspector } from '../intelligence/ClaimVerificationInspector';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@openresearch/ui';
import { CITATION_STYLES } from '../../lib/citationStyles';

interface SourcePanelProps {
  isCollapsed: boolean;
  onToggle: () => void;
  activeSource?: GroundedPassage | null;
  onOpenPaperInReader?: (paperId: string, pageNumber: number) => void;
  onOpenBibtexModal?: (tab?: 'import' | 'export') => void;
  onFindSourcesForClaim?: (suggestedQuery: string) => void;
  unsupportedClaimsCount?: number;
  onClaimsCounted?: (unsupported: number, total: number) => void;
}

export const SourcePanel: React.FC<SourcePanelProps> = ({
  isCollapsed,
  onToggle,
  activeSource,
  onOpenPaperInReader,
  onOpenBibtexModal,
  onFindSourcesForClaim,
  unsupportedClaimsCount = 0,
  onClaimsCounted,
}) => {
  const { citationStyle, setCitationStyle, documentCitations, recentlyAddedRefId } = useDocument();
  const { papers } = usePaper();

  const [activeTab, setActiveTab] = useState<'source' | 'claims' | 'bibliography'>('source');
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

  // Map cited document citations to BibliographicReference objects
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

  const formattedBibliography = useMemo(() => {
    return generateBibliography(citedReferences, citationStyle);
  }, [citedReferences, citationStyle]);

  const handleCopyAll = async () => {
    if (formattedBibliography.length === 0) return;
    const text = formattedBibliography.map((f) => f.bibliographyEntry).join('\n\n');
    const ok = await copyWithFallback(text);
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } else {
      setCopyFallback('Copy failed. Please select and copy manually.');
      setTimeout(() => setCopyFallback(null), 3000);
    }
  };

  const handleCopySingle = async (refId: string, entryText: string) => {
    const ok = await copyWithFallback(entryText);
    if (ok) {
      setCopiedId(refId);
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      setCopyFallback('Copy failed. Please select and copy manually.');
      setTimeout(() => setCopyFallback(null), 3000);
    }
  };

  const styleOptions = CITATION_STYLES.map((s) => ({ id: s.id, label: t(s.labelKey) }));

  // Collapsed/expanded handled via width transition below

  return (
    <aside
      className={`border-l border-border-default ${isCollapsed ? 'bg-sunken' : 'bg-surface'} flex flex-col shrink-0 overflow-visible contain-layout transition-[width,background-color] duration-250 ease-smooth-out ${isCollapsed ? 'w-[var(--source-panel-collapsed-width)] items-center py-4 cursor-pointer hover:bg-surface' : 'w-[var(--source-panel-width)]'}`}
      onClick={isCollapsed ? onToggle : undefined}
    >
      {isCollapsed ? (
        <div className="flex flex-col items-center justify-between h-full py-4">
          <button className="p-1 text-text-tertiary hover:text-text-primary mb-6 focus-visible:ring-2 focus-visible:ring-accent rounded transition-transform duration-150 active:scale-90">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="[writing-mode:vertical-rl] rotate-180 flex items-center space-x-2 text-xs font-semibold text-text-secondary tracking-wider uppercase">
            <span>{t('sourcePanel.title')}</span>
          </div>
          <div className="mt-auto flex flex-col items-center gap-1.5">
            {unsupportedClaimsCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="px-1.5 py-0.5 rounded bg-trust-warning/20 border border-trust-warning/40 text-[9px] font-mono text-trust-warning font-bold flex items-center gap-1 animate-in zoom-in-95 fade-in duration-150">
                    <AlertTriangle className="w-3 h-3 text-trust-warning" />
                    <span>{unsupportedClaimsCount}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{`${unsupportedClaimsCount} unsupported claims`}</TooltipContent>
              </Tooltip>
            )}
            <div className="px-1.5 py-1 rounded bg-surface border border-border-default text-[10px] font-mono text-text-tertiary">
              {citedReferences.length > 0 ? citedReferences.length : activeSource ? '1' : '0'}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col flex-1 overflow-y-auto">

        {/* Panel Header */}
      <div className="h-[var(--topbar-height)] border-b border-border-default px-4 flex items-center justify-between shrink-0 bg-surface">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {t('sourcePanel.title')}
          </h2>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[11px] text-text-tertiary font-mono">
            {t('sourcePanel.toggleHint')}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggle}
                className="p-1 rounded hover:bg-sunken text-text-tertiary hover:text-text-primary transition-[transform,background-color,color] duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Collapse (Ctrl+\)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'source' | 'claims' | 'bibliography')} className="flex flex-col flex-1">
        <div className="px-3 pt-3 pb-2 border-b border-border-default/60 bg-surface">
          <TabsList className="w-full h-auto p-1 bg-sunken rounded-lg border border-border-default/60 flex items-center gap-1">
            <TabsTrigger
              value="source"
              className="flex-1 min-w-0 py-1.5 px-2 text-[11px] font-medium flex items-center justify-center gap-1.5 rounded-md transition-all truncate data-[state=active]:bg-surface data-[state=active]:text-text-primary data-[state=active]:font-semibold data-[state=active]:shadow-xs hover:text-text-primary"
              title={t('sourcePanel.activeSource')}
            >
              <Quote className="w-3.5 h-3.5 shrink-0 text-accent/70" />
              <span className="truncate">Passage</span>
            </TabsTrigger>

            <TabsTrigger
              value="claims"
              className="flex-1 min-w-0 py-1.5 px-2 text-[11px] font-medium flex items-center justify-center gap-1.5 rounded-md transition-all truncate data-[state=active]:bg-surface data-[state=active]:text-text-primary data-[state=active]:font-semibold data-[state=active]:shadow-xs hover:text-text-primary"
              title="Claim Verification & Flags"
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-accent/70" />
              <span className="truncate">Claims</span>
              {unsupportedClaimsCount > 0 && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-trust-warning/20 text-trust-warning font-bold flex items-center gap-0.5 shrink-0">
                  <AlertTriangle className="w-2.5 h-2.5 text-trust-warning inline" />
                  <span>{unsupportedClaimsCount}</span>
                </span>
              )}
            </TabsTrigger>

            <TabsTrigger
              value="bibliography"
              className="flex-1 min-w-0 py-1.5 px-2 text-[11px] font-medium flex items-center justify-center gap-1.5 rounded-md transition-all truncate data-[state=active]:bg-surface data-[state=active]:text-text-primary data-[state=active]:font-semibold data-[state=active]:shadow-xs hover:text-text-primary"
              title={t('sourcePanel.bibliography')}
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0 text-accent/70" />
              <span className="truncate">Bibliography</span>
              {citedReferences.length > 0 && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface border border-border-default text-text-tertiary shrink-0">
                  {citedReferences.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="p-4 space-y-4 flex-1">
          <TabsContent value="source" className="space-y-4 mt-0 data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-150">
            {/* Active Inspected Passage Card */}
            {activeSource ? (
              <div className="p-3.5 rounded-lg border border-trust-grounded/40 bg-trust-grounded/5 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-trust-grounded font-semibold text-xs">
                    <ShieldCheck className="w-4 h-4" />
                    <span>{t('sourcePanel.activeSource')}</span>
                    <sup className="font-bold">1</sup>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface border border-trust-grounded/30 text-trust-grounded">
                    {Math.round(activeSource.confidence * 100)}% match
                  </span>
                </div>

                <div className="space-y-1">
                  <h3 className="font-serif font-bold text-xs text-text-primary leading-snug">
                    {activeSource.paperTitle}
                  </h3>
                  <p className="text-[11px] text-text-secondary">
                    {activeSource.authors} {activeSource.year ? `(${activeSource.year})` : ''}
                  </p>
                </div>

                <div className="flex items-center space-x-3 text-[11px] text-text-tertiary font-mono pt-0.5 border-t border-border-default/40">
                  <span>{t('sourcePanel.page')} {activeSource.pageNumber ?? 1}</span>
                  <span>•</span>
                  <span className="truncate">{activeSource.section}</span>
                </div>

                {/* Exact Highlighted Passage Excerpt */}
                <div className="p-2.5 rounded bg-surface border border-border-default text-xs text-text-primary leading-relaxed italic border-l-3 border-l-trust-grounded">
                  &quot;{activeSource.passageText}&quot;
                </div>

                {/* Jump to Reader Action */}
                {onOpenPaperInReader && (
                  <button
                    type="button"
                    onClick={() => onOpenPaperInReader(activeSource.paperId, activeSource.pageNumber ?? 1)}
                    className="w-full py-1.5 px-2.5 rounded bg-accent text-accent-solid-fg hover:bg-accent/90 flex items-center justify-center space-x-1.5 text-xs font-medium transition-[transform,background-color,box-shadow] duration-150 active:scale-[0.98] [@media(hover:hover)]:hover:-translate-y-px shadow-2xs focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>{t('sourcePanel.openInReader')} (P.{activeSource.pageNumber ?? 1})</span>
                    <ExternalLink className="w-3 h-3 ml-1 opacity-80" />
                  </button>
                )}
              </div>
            ) : (
              <div className="p-3.5 rounded border border-border-default bg-sunken space-y-2">
                <div className="flex items-center space-x-2 text-xs font-medium text-text-primary">
                  <Info className="w-4 h-4 text-accent shrink-0" />
                  <span>{t('sourcePanel.emptyHeader')}</span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {t('sourcePanel.emptyDescription')}
                </p>
              </div>
            )}

            {/* Trust Markers Reference (§5.1) */}
            <div className="p-3.5 rounded border border-border-default bg-surface space-y-3">
              <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                Trust Legend
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between text-trust-grounded">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-trust-grounded"></span>
                    <span className="font-medium">{t('trust.sourceGrounded')}</span>
                  </div>
                  <sup className="font-bold text-xs">¹ ² ³</sup>
                </div>
                <div className="flex items-center justify-between text-trust-inference">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-trust-inference"></span>
                    <span className="font-medium">{t('trust.aiInference')}</span>
                  </div>
                  <sup className="font-bold text-xs">∇</sup>
                </div>
                <div className="flex items-center justify-between text-trust-general">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-trust-general"></span>
                    <span className="font-medium">{t('trust.generalKnowledge')}</span>
                  </div>
                  <span className="text-[10px] text-text-tertiary">legend only</span>
                </div>
              </div>
            </div>

            {/* Traceability Hint */}
            {!activeSource && (
              <div className="flex flex-col items-center justify-center p-6 text-center text-text-tertiary space-y-2 border border-dashed border-border-default rounded">
                <Quote className="w-6 h-6 opacity-40" />
                <p className="text-xs leading-normal">
                  {t('sourcePanel.noActiveSource')}
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="claims" className="space-y-4 mt-0 data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-150">
            <ClaimVerificationInspector onFindSources={onFindSourcesForClaim} onClaimsCounted={onClaimsCounted} />
          </TabsContent>

          <TabsContent value="bibliography" className="space-y-4 mt-0 data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-150">
            {/* Style Selector & Quick Actions */}
            <div className="flex items-center justify-between pb-2 border-b border-border-default/60">
              <div className="flex items-center space-x-1.5 text-xs">
                <span className="text-text-secondary font-medium">{t('sourcePanel.styleSelector')}:</span>
                <Select value={citationStyle} onValueChange={(v) => setCitationStyle(v as CitationStyle)}>
                  <SelectTrigger className="w-auto min-w-[110px] h-6 text-xs font-semibold bg-surface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {styleOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {formattedBibliography.length > 0 && (
                <div className="flex items-center space-x-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleCopyAll}
                        className="p-1 rounded hover:bg-sunken text-text-secondary hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {copiedAll ? <Check className="w-3.5 h-3.5 text-trust-grounded" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t('sourcePanel.copyBib')}</TooltipContent>
                  </Tooltip>
                  {onOpenBibtexModal && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onOpenBibtexModal('export')}
                          className="p-1 rounded hover:bg-sunken text-text-secondary hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t('sourcePanel.exportBib')}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>

            {copyFallback && (
              <div role="alert" className="p-2 rounded border border-trust-warning/30 bg-trust-warning/10 text-xs text-trust-warning">
                {copyFallback}
              </div>
            )}

            {/* References List */}
            {formattedBibliography.length > 0 ? (
              <div className="space-y-3">
                {formattedBibliography.map((item) => {
                  const isRecentlyAdded = recentlyAddedRefId === item.referenceId;
                  return (
                    <div
                      key={item.referenceId}
                      style={!isRecentlyAdded ? { animationDelay: `${Math.min(formattedBibliography.indexOf(item) * 40, 240)}ms` } : undefined}
                      className={`p-2.5 rounded border text-xs leading-relaxed transition-[transform,background-color,border-color,box-shadow] duration-250 ease-smooth-out ${
                        isRecentlyAdded
                          ? 'border-accent bg-accent/20 ring-2 ring-accent/30 animate-in fade-in duration-150'
                          : 'border-border-default/70 bg-surface hover:border-accent/40 animate-fade-slide-in'
                      }`}
                      ref={(el) => {
                        if (isRecentlyAdded && el) {
                          const t = setTimeout(() => {
                            el.style.transform = '';
                          }, 900);
                          return () => clearTimeout(t);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between text-[10px] text-text-tertiary font-mono mb-1">
                        <span className="font-bold text-accent">{item.inlineMarker}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => handleCopySingle(item.referenceId, item.bibliographyEntry)}
                              className="hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent rounded"
                            >
                              {copiedId === item.referenceId ? (
                                <Check className="w-3 h-3 text-trust-grounded" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Copy entry</TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="font-serif text-[11px] text-text-primary">
                        {item.bibliographyEntry}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-text-secondary space-y-2 border border-dashed border-border-default rounded">
                <Quote className="w-6 h-6 mx-auto text-text-tertiary opacity-40" />
                <p className="text-xs">{t('sourcePanel.emptyBib')}</p>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
      </div>
      )}
    </aside>
  );
};
