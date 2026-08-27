'use client';

import React, { useState } from 'react';
import { usePaper } from '../../context/PaperContext';
import { useProject } from '../../context/ProjectContext';
import {
  api,
  ResearchGapsResponseDTO,
  ResearchGapItemDTO,
  ResearchGapLimitationDTO,
  ResearchGapQuoteDTO,
} from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { t } from '../../i18n';
import { ViewHeader } from '../shell/ViewHeader';
import {
  Compass,
  Sparkles,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Download,
  PlusCircle,
  Loader2,
  X,
  FileQuestion,
  Lightbulb,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';

export type AuthorLimitation = ResearchGapLimitationDTO;
export type FutureWorkQuote = ResearchGapQuoteDTO;
export type PotentialGap = ResearchGapItemDTO;

interface ResearchGapAssistantViewProps {
  onInsertIntoDocument?: (markdownContent: string) => void;
  onClose?: () => void;
}

export const ResearchGapAssistantView: React.FC<ResearchGapAssistantViewProps> = ({
  onInsertIntoDocument,
  onClose,
}) => {
  const { activeProject } = useProject();
  const { papers } = usePaper();

  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [focusTopic, setFocusTopic] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedState, setCopiedState] = useState(false);
  const [expandedGapIds, setExpandedGapIds] = useState<Set<string>>(new Set());

  const [gapData, setGapData] = useState<ResearchGapsResponseDTO | null>(null);

  const handleToggleGap = (gapId: string) => {
    setExpandedGapIds((prev) => {
      const next = new Set(prev);
      if (next.has(gapId)) {
        next.delete(gapId);
      } else {
        next.add(gapId);
      }
      return next;
    });
  };

  const handleAnalyzeGaps = async () => {
    if (!activeProject) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const payloadIds = selectedPaperIds.length > 0 ? selectedPaperIds : papers.map((p) => p.id);
      const res = await api.intelligence.researchGaps(activeProject.id, {
        paper_ids: payloadIds,
        focus_topic: focusTopic.trim() || undefined,
      });

      setGapData(res);
      // Expand all gaps by default
      if (res.potential_gaps && res.potential_gaps.length > 0) {
        setExpandedGapIds(new Set(res.potential_gaps.map((g) => g.id)));
      }
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, 'Failed to analyze research gaps.'));
    } finally {
      setIsLoading(false);
    }
  };

  const formatGapsAsMarkdown = (): string => {
    if (!gapData) return '';
    let md = `# Potential Research Gaps — ${activeProject?.name || 'Project'}\n\n`;
    md += `> **Disclaimer:** ${gapData.disclaimer} (Confidence scoring deferred)\n\n`;

    gapData.potential_gaps.forEach((gap, idx) => {
      md += `## Gap #${idx + 1}: ${gap.title}\n`;
      md += `**Category:** ${gap.category} | **Evidence count:** ${gap.raw_evidence_count} source items across ${gap.supporting_papers_count} papers\n\n`;
      md += `${gap.description}\n\n`;

      if (gap.author_limitations.length > 0) {
        md += `### Author-Stated Limitations:\n`;
        gap.author_limitations.forEach((lim) => {
          md += `- **${lim.authors} (${lim.year || 'n.d.'})** [${lim.section}, p.${lim.page_number}]: "${lim.excerpt}"\n`;
        });
        md += `\n`;
      }

      if (gap.future_work_quotes.length > 0) {
        md += `### Author Open Challenges & Future Work:\n`;
        gap.future_work_quotes.forEach((fw) => {
          md += `- **${fw.authors} (${fw.year || 'n.d.'})**: "${fw.excerpt}"\n`;
        });
        md += `\n`;
      }
    });

    return md;
  };

  const handleCopyMarkdown = () => {
    const md = formatGapsAsMarkdown();
    navigator.clipboard.writeText(md);
    setCopiedState(true);
    setTimeout(() => setCopiedState(false), 2000);
  };

  const handleInsert = () => {
    if (!onInsertIntoDocument) return;
    onInsertIntoDocument(formatGapsAsMarkdown());
  };

  return (
    <div className="flex flex-col h-full bg-surface border border-border-default rounded-lg overflow-hidden shadow-xs">
      {/* Header */}
      <ViewHeader
        icon={<Compass className="w-5 h-5" />}
        title={t('intelligence.gapsModalTitle')}
        subtitle={t('intelligence.gapsModalSubtitle')}
        actions={
          onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-text-secondary hover:text-text-primary rounded-md hover:bg-sunken transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )
        }
      />

      {/* Mandatory Disclaimer Banner */}
      <div className="px-6 py-2.5 bg-trust-warning/10 border-b border-trust-warning/20 flex items-center justify-between text-xs text-trust-warning">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="font-medium">
              Potential Research Gaps (Heuristic) · Not LLM-powered · Confidence scoring deferred.
            </span>
        </div>
        <span className="text-[11px] font-mono opacity-80">v1 Mechanical Scope</span>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side: Setup Controls */}
        <div className="w-full md:w-80 border-r border-border-default bg-sunken flex flex-col p-4">
          <label className="text-xs font-semibold text-text-primary mb-1.5">
            Focus Topic / Question (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. Memory complexity, cross-domain generalization"
            value={focusTopic}
            onChange={(e) => setFocusTopic(e.target.value)}
            className="w-full text-xs px-3 py-1.5 rounded border border-border-default bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent mb-4"
          />

          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Literature Scope
            </span>
            <span className="text-[11px] text-text-tertiary">
              {selectedPaperIds.length > 0
                ? `${selectedPaperIds.length} selected`
                : `All ${papers.length} papers`}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 mb-3">
            {papers.length === 0 ? (
              <div className="text-center py-6 text-xs text-text-tertiary">
                No papers in project library.
              </div>
            ) : (
              papers.map((paper) => {
                const isSelected = selectedPaperIds.includes(paper.id);
                return (
                  <label
                    key={paper.id}
                    style={{ animationDelay: `${Math.min(papers.indexOf(paper) * 40, 200)}ms` }}
                    className={`flex items-start gap-2.5 p-2 rounded border cursor-pointer transition-[border-color,background-color] duration-150 animate-fade-slide-in ${
                      isSelected
                        ? 'bg-accent/5 border-accent text-text-primary'
                        : 'bg-surface border-border-default hover:border-accent/20 text-text-secondary'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setSelectedPaperIds((prev) =>
                          prev.includes(paper.id)
                            ? prev.filter((id) => id !== paper.id)
                            : [...prev, paper.id]
                        );
                      }}
                      className="mt-0.5 rounded border-border-default text-accent focus:ring-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium line-clamp-1 text-text-primary">
                        {paper.title}
                      </p>
                      <p className="text-[11px] text-text-secondary mt-0.5">
                        {paper.authors?.[0]?.familyName || 'Author'} · {paper.year || 'n.d.'}
                      </p>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <button
            onClick={handleAnalyzeGaps}
            disabled={isLoading || papers.length === 0}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-accent text-accent-solid-fg rounded text-xs font-semibold hover:bg-accent-hover disabled:opacity-50 transition-[background-color,opacity] duration-150 active:scale-[0.97] shadow-xs"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t('intelligence.analyzingGaps')}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t('intelligence.analyzeGaps')}</span>
              </>
            )}
          </button>
        </div>

        {/* Right Side: Gap Results */}
        <div className="flex-1 flex flex-col bg-surface overflow-hidden">
          {errorMessage && (
            <div className="m-4 p-3 bg-trust-warning/10 border border-trust-warning/30 rounded text-xs text-trust-warning flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {!gapData && !isLoading && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-secondary">
              <div className="w-12 h-12 rounded-full bg-sunken flex items-center justify-center mb-3 text-text-tertiary">
                <Lightbulb className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">
                Author-Limitation & Future Work Synthesis (Heuristic)
              </h3>
              <p className="text-xs text-text-secondary max-w-md mb-4">
                Discovers potential research opportunities by keyword-matching author-stated limitations
                and future work across your literature library. This is a heuristic analysis, not LLM-powered.
              </p>
              <button
                onClick={handleAnalyzeGaps}
                disabled={papers.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-solid-fg rounded text-xs font-medium hover:bg-accent-hover transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Analyze Project Research Gaps
              </button>
            </div>
          )}

          {isLoading && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-secondary">
              <div className="flex flex-col items-center gap-2 animate-pulse-subtle">
                <Loader2 className="w-8 h-8 text-accent animate-spin" />
                <h3 className="text-sm font-semibold text-text-primary">Scanning Papers for Stated Limitations & Future Work...</h3>
                <p className="text-xs text-text-secondary max-w-sm">Parsing discussion sections, methodology constraints, and empirical boundary conditions.</p>
              </div>
              <div className="w-full max-w-md space-y-2 pt-6">
                {[0,1,2].map(i => <div key={i} className="h-20 bg-sunken rounded skeleton" style={{ animationDelay: `${i*40}ms` }} />)}
              </div>
            </div>
          )}

          {gapData && (
            <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-250">
              {/* Action Toolbar */}
              <div className="flex items-center justify-between px-6 py-2.5 border-b border-border-default bg-sunken/40">
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {gapData.potential_gaps.length} Potential Gaps Identified
                  </span>
                  <span>·</span>
                  <span>{gapData.analyzed_papers_count} Papers Analyzed</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyMarkdown}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-border-default bg-surface text-text-primary hover:bg-sunken transition-colors"
                  >
                    {copiedState ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-trust-success" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Summary</span>
                      </>
                    )}
                  </button>
                  {onInsertIntoDocument && (
                    <button
                      onClick={handleInsert}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-accent text-accent-solid-fg hover:bg-accent-hover transition-colors"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>{t('intelligence.insertGaps')}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Gaps List */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {gapData.potential_gaps.map((gap, index) => {
                  const isExpanded = expandedGapIds.has(gap.id);
                  return (
                    <div
                      key={gap.id}
                      style={{ animationDelay: `${Math.min(index * 40, 280)}ms` }}
                      className="rounded-lg border border-border-default bg-surface overflow-hidden transition-[box-shadow,border-color] duration-150 hover:shadow-md animate-fade-slide-in shadow-xs"
                    >
                      {/* Gap Card Header */}
                      <div
                        onClick={() => handleToggleGap(gap.id)}
                        className="p-4 flex items-start justify-between cursor-pointer hover:bg-sunken/40 transition-[background-color] duration-150"
                      >
                        <div className="flex items-start gap-3">
                          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent/10 text-accent font-semibold text-xs shrink-0 mt-0.5">
                            {index + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm text-text-primary">
                                {gap.title}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-sunken text-text-secondary border border-border-default">
                                {gap.category}
                              </span>
                            </div>
                            <p className="text-xs text-text-secondary leading-relaxed">
                              {gap.description}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0 ml-4">
                          <span className="px-2.5 py-1 rounded text-xs font-medium bg-trust-warning/10 text-trust-warning border border-trust-warning/20">
                            {gap.raw_evidence_count} evidence citations
                          </span>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-text-tertiary transition-transform duration-150" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-text-tertiary transition-transform duration-150" />
                          )}
                        </div>
                      </div>

                      {/* Expandable Evidence Details - height animated */}
                      <div
                        className="overflow-hidden transition-[max-height,opacity,padding] duration-150 ease-smooth-out data-[state=closing]:duration-80 data-[state=closing]:ease-in"
                        data-state={isExpanded ? 'open' : 'closed'}
                        style={{
                          maxHeight: isExpanded ? '1000px' : '0',
                          opacity: isExpanded ? 1 : 0,
                          paddingTop: isExpanded ? '8px' : '0',
                          paddingBottom: isExpanded ? '20px' : '0',
                        }}
                      >
                          {/* Author Limitations */}
                          {gap.author_limitations.length > 0 && (
                            <div>
                              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-2 flex items-center gap-1.5">
                                <BookOpen className="w-3.5 h-3.5 text-accent" />
                                <span>{t('intelligence.authorLimitations')}</span>
                              </h4>
                              <div className="space-y-2">
                                {gap.author_limitations.map((lim, i) => (
                                  <div
                                    key={i}
                                    className="p-3 rounded bg-surface border border-border-default text-xs"
                                  >
                                    <div className="flex items-center justify-between text-text-secondary mb-1">
                                      <span className="font-semibold text-text-primary">
                                        {lim.paper_title}
                                      </span>
                                      <span>
                                        {lim.authors} ({lim.year || 'n.d.'}) · p.{lim.page_number}
                                      </span>
                                    </div>
                                    <p className="font-serif italic text-text-secondary bg-sunken/50 p-2 rounded border border-border-default/50 my-1">
                                      &quot;{lim.excerpt}&quot;
                                    </p>
                                    <p className="text-[11px] text-accent font-medium mt-1">
                                      ↳ Paraphrased constraint: {lim.paraphrased_limitation}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Future Work Opportunities */}
                          {gap.future_work_quotes.length > 0 && (
                            <div>
                              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-2 flex items-center gap-1.5">
                                <ArrowRight className="w-3.5 h-3.5 text-trust-success" />
                                <span>{t('intelligence.futureWorkTitle')}</span>
                              </h4>
                              <div className="space-y-2">
                                {gap.future_work_quotes.map((fw, i) => (
                                  <div
                                    key={i}
                                    className="p-3 rounded bg-surface border border-border-default text-xs"
                                  >
                                    <div className="flex items-center justify-between text-text-secondary mb-1">
                                      <span className="font-semibold text-text-primary">
                                        {fw.paper_title}
                                      </span>
                                      <span>
                                        {fw.authors} ({fw.year || 'n.d.'})
                                      </span>
                                    </div>
                                    <p className="font-serif italic text-text-secondary bg-sunken/50 p-2 rounded border border-border-default/50 my-1">
                                      &quot;{fw.excerpt}&quot;
                                    </p>
                                    <p className="text-[11px] text-trust-success font-medium mt-1">
                                      ↳ Research opportunity: {fw.paraphrased_opportunity}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
