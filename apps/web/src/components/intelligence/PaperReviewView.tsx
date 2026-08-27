'use client';

import React, { useState } from 'react';
import { useDocument } from '../../context/DocumentContext';
import { useProject } from '../../context/ProjectContext';
import { api, PaperReviewResponseDTO, ReviewCategorySummaryDTO, ReviewIssueDTO } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { t } from '../../i18n';
import { ViewHeader } from '../shell/ViewHeader';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileCheck2,
  Sparkles,
  Loader2,
  X,
  Layers,
  Quote,
  PenTool,
  Scale,
  Library,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  SlidersHorizontal
} from 'lucide-react';

export type ReviewCategorySummary = ReviewCategorySummaryDTO;
export type ReviewIssue = ReviewIssueDTO;

export type ReviewTab = 'all' | 'structure' | 'citations' | 'writing' | 'argumentation' | 'sources';
export type SeverityFilter = 'all' | 'warning' | 'suggestion';

interface PaperReviewViewProps {
  onClose?: () => void;
}

export const PaperReviewView: React.FC<PaperReviewViewProps> = ({ onClose }) => {
  const { activeProject } = useProject();
  const { activeDocument, documents, setActiveDocument } = useDocument();

  const [selectedDocId, setSelectedDocId] = useState<string>(activeDocument?.id || '');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReviewTab>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');

  const [reviewResult, setReviewResult] = useState<PaperReviewResponseDTO | null>(null);

  const handleRunReview = async () => {
    if (!activeProject) return;
    const docToReview = documents.find((d) => d.id === selectedDocId) || activeDocument;
    if (!docToReview) {
      setErrorMessage('No document selected to review.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await api.intelligence.paperReview(activeProject.id, {
        document_id: docToReview.id,
        text: docToReview.plain_text || '',
        title: docToReview.title || 'Untitled Paper',
      });
      setReviewResult(res);
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, 'Failed to analyze manuscript.'));
    } finally {
      setIsLoading(false);
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'structure':
        return <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
      case 'citations':
        return <Quote className="w-4 h-4 text-purple-600 dark:text-purple-400" />;
      case 'writing':
        return <PenTool className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
      case 'argumentation':
        return <Scale className="w-4 h-4 text-amber-600 dark:text-amber-400" />;
      case 'sources':
        return <Library className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />;
      default:
        return <FileCheck2 className="w-4 h-4 text-accent" />;
    }
  };

  const filteredIssues = (reviewResult?.issues || []).filter((issue) => {
    if (activeTab !== 'all' && issue.category !== activeTab) return false;
    if (severityFilter !== 'all' && issue.severity !== severityFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-surface border border-border-default rounded-lg overflow-hidden shadow-xs">
      {/* Header */}
      <ViewHeader
        icon={<FileCheck2 className="w-5 h-5" />}
        title={t('intelligence.reviewModalTitle')}
        subtitle={t('intelligence.reviewModalSubtitle')}
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

      {/* Control Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-default bg-sunken">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-text-secondary">Document:</label>
          <select
            value={selectedDocId || activeDocument?.id || ''}
            onChange={(e) => setSelectedDocId(e.target.value)}
            className="text-xs px-3 py-1.5 rounded border border-border-default bg-surface text-text-primary focus:outline-none focus:border-accent"
          >
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || 'Untitled Paper'}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleRunReview}
          disabled={isLoading || documents.length === 0}
          className="flex items-center gap-1.5 py-1.5 px-4 bg-accent text-accent-solid-fg rounded text-xs font-semibold hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-xs"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{t('intelligence.runningReview')}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('intelligence.runReview')}</span>
            </>
          )}
        </button>
      </div>

      {/* Main Review Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {errorMessage && (
          <div className="m-4 p-3 bg-trust-warning/10 border border-trust-warning/30 rounded text-xs text-trust-warning flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {!reviewResult && !isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-secondary">
            <div className="w-12 h-12 rounded-full bg-sunken flex items-center justify-center mb-3 text-text-tertiary">
              <FileCheck2 className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-text-primary mb-1">
              5-Dimension Manuscript Diagnostics
            </h3>
            <p className="text-xs text-text-secondary max-w-md mb-4">
              Inspect your manuscript across structure, empirical citation support, academic tone,
              argumentative robustness, and source quality before submitting.
            </p>
            <button
              onClick={handleRunReview}
              disabled={documents.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-accent text-accent-solid-fg rounded text-xs font-medium hover:bg-accent-hover transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Analyze Active Document
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-secondary">
            <Loader2 className="w-8 h-8 text-accent animate-spin mb-3" />
            <h3 className="text-sm font-semibold text-text-primary">
              Running 5-Dimension Academic Review...
            </h3>
            <p className="text-xs text-text-secondary mt-1 max-w-sm">
              Checking section organization, hedging balance, citation coverage, and logical consistency.
            </p>
          </div>
        )}

        {reviewResult && (
          <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6">
            {/* Top Score Summary Banner */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              {/* Overall Score */}
              <div className="md:col-span-1 p-4 rounded-lg bg-sunken border border-border-default flex flex-col items-center justify-center text-center">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                  Overall Health
                </span>
                <div className="text-3xl font-bold text-accent my-1">
                  {reviewResult.overall_score}
                  <span className="text-xs text-text-secondary font-normal">/100</span>
                </div>
                <span className="text-[10px] text-text-secondary">
                  {reviewResult.issues.length} diagnostics
                </span>
              </div>

              {/* 5 Dimension Cards */}
              {Object.entries(reviewResult.categories).map(([catKey, cat]) => (
                <div
                  key={catKey}
                  onClick={() => setActiveTab(catKey as any)}
                  className={`p-3 rounded-lg border cursor-pointer transition-[background-color,border-color,box-shadow] duration-150 ${
                    activeTab === catKey
                      ? 'bg-accent/5 border-accent shadow-xs'
                      : 'bg-surface border-border-default hover:border-border-default/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      {getCategoryIcon(catKey)}
                      <span className="text-xs font-semibold capitalize text-text-primary">
                        {catKey}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-text-primary">{cat.score}%</span>
                  </div>
                  <p className="text-[11px] text-text-secondary line-clamp-2 mt-1">
                    {cat.summary_text}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-[10px]">
                    <span className="text-trust-warning font-medium">{cat.warnings} flags</span>
                    <span className="text-text-tertiary">·</span>
                    <span className="text-accent font-medium">{cat.suggestions} tips</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center justify-between border-b border-border-default pb-2">
              <div className="flex items-center gap-2">
                {[
                  { id: 'all', label: 'All Issues' },
                  { id: 'structure', label: 'Structure' },
                  { id: 'citations', label: 'Citations' },
                  { id: 'writing', label: 'Writing' },
                  { id: 'argumentation', label: 'Argumentation' },
                  { id: 'sources', label: 'Sources' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-accent text-accent-solid-fg'
                        : 'text-text-secondary hover:text-text-primary hover:bg-sunken'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-secondary">Severity:</span>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as any)}
                  className="px-2 py-0.5 rounded border border-border-default bg-surface text-text-primary text-xs focus:outline-none"
                >
                  <option value="all">All Severities</option>
                  <option value="warning">Warnings only</option>
                  <option value="suggestion">Suggestions only</option>
                </select>
              </div>
            </div>

            {/* Issue Cards */}
            <div className="space-y-3">
              {filteredIssues.length === 0 ? (
                <div className="text-center py-8 text-xs text-text-secondary bg-sunken/40 rounded-lg border border-border-default">
                  <CheckCircle2 className="w-6 h-6 text-trust-success mx-auto mb-2" />
                  <p className="font-semibold text-text-primary">
                    {t('intelligence.noIssues')}
                  </p>
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    No diagnostic flags detected for current filter criteria.
                  </p>
                </div>
              ) : (
                filteredIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="p-4 rounded-lg bg-surface border border-border-default shadow-xs space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {issue.severity === 'warning' ? (
                          <AlertTriangle className="w-4 h-4 text-trust-warning shrink-0" />
                        ) : (
                          <Sparkles className="w-4 h-4 text-accent shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-text-primary">
                          {issue.title}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-sunken text-text-secondary border border-border-default">
                          {issue.category}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          issue.severity === 'warning'
                            ? 'bg-trust-warning/10 text-trust-warning border border-trust-warning/20'
                            : 'bg-accent/10 text-accent border border-accent/20'
                        }`}
                      >
                        {issue.severity}
                      </span>
                    </div>

                    <p className="text-xs text-text-secondary leading-relaxed">
                      {issue.description}
                    </p>

                    {issue.flagged_text && (
                      <div className="p-2.5 bg-sunken rounded border border-border-default font-serif text-xs italic text-text-secondary">
                        &quot;{issue.flagged_text}&quot;
                      </div>
                    )}

                    <div className="p-2.5 bg-accent/5 rounded border border-accent/20 flex items-start gap-2 text-xs text-text-primary">
                      <ArrowUpRight className="w-3.5 h-3.5 text-accent mt-0.5 shrink-0" />
                      <div>
                        <span className="font-semibold text-accent">Recommendation: </span>
                        <span>{issue.suggestion}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
