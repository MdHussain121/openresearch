'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { usePaper } from '../../context/PaperContext';
import { useProject } from '../../context/ProjectContext';
import { api, LiteratureMatrixResponseDTO, LiteratureMatrixRowDTO, MatrixCellDTO } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { t } from '../../i18n';
import { ViewHeader } from '../shell/ViewHeader';
import {
  Table as TableIcon,
  Sparkles,
  Download,
  Copy,
  Check,
  FileText,
  ExternalLink,
  ChevronRight,
  Loader2,
  AlertCircle,
  X,
  PlusCircle,
  Layers,
  BookOpen
} from 'lucide-react';

export type CellDetail = MatrixCellDTO;
export type MatrixRow = LiteratureMatrixRowDTO;

interface LiteratureMatrixViewProps {
  onInsertIntoDocument?: (markdownContent: string) => void;
  onClose?: () => void;
}

export const LiteratureMatrixView: React.FC<LiteratureMatrixViewProps> = ({
  onInsertIntoDocument,
  onClose,
}) => {
  const { activeProject } = useProject();
  const { papers } = usePaper();

  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedState, setCopiedState] = useState(false);

  // Result Matrix State
  const [matrixData, setMatrixData] = useState<LiteratureMatrixResponseDTO | null>(null);

  // Active Cell Inspector Drawer
  const [inspectedCell, setInspectedCell] = useState<{
    columnName: string;
    cell: CellDetail;
  } | null>(null);
  const [isInspectorClosing, setIsInspectorClosing] = useState(false);

  const handleCloseInspector = useCallback(() => {
    setIsInspectorClosing(true);
    setTimeout(() => {
      setIsInspectorClosing(false);
      setInspectedCell(null);
    }, 400); // matches --duration-slow (400ms)
  }, []);

  // Filtered papers list for selection
  const filteredPapers = useMemo(() => {
    if (!searchFilter.trim()) return papers;
    const q = searchFilter.toLowerCase();
    return papers.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.authors && p.authors.some((a) => (a.familyName || '').toLowerCase().includes(q)))
    );
  }, [papers, searchFilter]);

  const handleTogglePaper = (paperId: string) => {
    setSelectedPaperIds((prev) =>
      prev.includes(paperId) ? prev.filter((id) => id !== paperId) : [...prev, paperId]
    );
  };

  const handleSelectAll = () => {
    setSelectedPaperIds(papers.map((p) => p.id));
  };

  const handleClearAll = () => {
    setSelectedPaperIds([]);
  };

  const handleGenerateMatrix = async () => {
    if (!activeProject) return;
    if (selectedPaperIds.length === 0 && papers.length === 0) {
      setErrorMessage(t('intelligence.noPapersSelected') || 'Please select at least one paper.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const payloadIds = selectedPaperIds.length > 0 ? selectedPaperIds : papers.map((p) => p.id);
      const res = await api.intelligence.literatureMatrix(activeProject.id, {
        paper_ids: payloadIds,
      });
      setMatrixData(res);
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, 'Failed to generate literature review matrix.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyMarkdown = () => {
    if (!matrixData) return;
    navigator.clipboard.writeText(matrixData.markdown_table);
    setCopiedState(true);
    setTimeout(() => setCopiedState(false), 2000);
  };

  const handleDownloadCsv = () => {
    if (!matrixData) return;
    const headers = ['Paper', 'Authors', 'Year', 'Method', 'Dataset', 'Results', 'Limitations'];
    const rows = matrixData.rows.map((r) => [
      `"${r.paper_title.replace(/"/g, '""')}"`,
      `"${r.authors.replace(/"/g, '""')}"`,
      r.year || '',
      `"${r.method.value.replace(/"/g, '""')}"`,
      `"${r.dataset.value.replace(/"/g, '""')}"`,
      `"${r.results.value.replace(/"/g, '""')}"`,
      `"${r.limitations.value.replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Literature_Matrix_${activeProject?.name || 'OpenResearch'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleInsert = () => {
    if (!matrixData || !onInsertIntoDocument) return;
    onInsertIntoDocument(matrixData.markdown_table);
  };

  return (
    <div className="flex flex-col h-full bg-surface border border-border-default rounded-lg overflow-hidden shadow-xs">
      {/* Header */}
      <ViewHeader
        icon={<TableIcon className="w-5 h-5" />}
        title={t('intelligence.matrixModalTitle')}
        subtitle={t('intelligence.matrixModalSubtitle')}
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

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side: Paper Selector */}
        <div className="w-full md:w-80 border-r border-border-default bg-sunken flex flex-col p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              {t('intelligence.selectPapersForMatrix')}
            </span>
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={handleSelectAll}
                className="text-accent hover:underline font-medium"
              >
                {t('intelligence.selectAll')}
              </button>
              <span className="text-text-tertiary">·</span>
              <button
                onClick={handleClearAll}
                className="text-text-secondary hover:text-text-primary"
              >
                {t('intelligence.clearAll')}
              </button>
            </div>
          </div>

          <input
            type="text"
            placeholder="Filter library papers..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full text-xs px-3 py-1.5 rounded border border-border-default bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent mb-3"
          />

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {filteredPapers.length === 0 ? (
              <div className="text-center py-8 text-xs text-text-tertiary">
                No papers found in library.
              </div>
            ) : (
              filteredPapers.map((paper) => {
                const isSelected = selectedPaperIds.includes(paper.id);
                const firstAuthor = paper.authors?.[0]?.familyName || 'Author';
                const authorStr =
                  (paper.authors || []).length > 1 ? `${firstAuthor} et al.` : firstAuthor;
                return (
                  <label
                    key={paper.id}
                    style={{ animationDelay: `${Math.min(filteredPapers.indexOf(paper) * 40, 240)}ms` }}
                    className={`flex items-start gap-2.5 p-2 rounded border cursor-pointer transition-[border-color,background-color] duration-150 animate-fade-slide-in ${
                      isSelected
                        ? 'bg-accent/5 border-accent text-text-primary'
                        : 'bg-surface border-border-default hover:border-accent/20 text-text-secondary'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleTogglePaper(paper.id)}
                      className="mt-0.5 rounded border-border-default text-accent focus:ring-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium line-clamp-1 leading-snug text-text-primary">
                        {paper.title}
                      </p>
                      <p className="text-[11px] text-text-secondary mt-0.5">
                        {authorStr} · {paper.year || 'n.d.'}
                      </p>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <div className="pt-3 border-t border-border-default mt-2">
            <button
              onClick={handleGenerateMatrix}
              disabled={isLoading || papers.length === 0}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-accent text-accent-solid-fg rounded text-xs font-semibold hover:bg-accent-hover disabled:opacity-50 transition-[background-color,opacity] duration-150 active:scale-[0.97] shadow-xs"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t('intelligence.generatingMatrix')}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {t('intelligence.generateMatrix')} (
                    {selectedPaperIds.length > 0 ? selectedPaperIds.length : papers.length})
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Side: Matrix Results Table */}
        <div className="flex-1 flex flex-col bg-surface overflow-hidden">
          {errorMessage && (
            <div className="m-4 p-3 bg-trust-warning/10 border border-trust-warning/30 rounded text-xs text-trust-warning flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {!matrixData && !isLoading && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-secondary">
              <div className="w-12 h-12 rounded-full bg-sunken flex items-center justify-center mb-3 text-text-tertiary">
                <TableIcon className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">
                Comparative Literature Review Matrix
              </h3>
              <p className="text-xs text-text-secondary max-w-md mb-4">
                Select papers from your library and generate a multi-dimensional matrix summarizing
                methodologies, benchmark datasets, empirical results, and identified limitations.
              </p>
              <button
                onClick={handleGenerateMatrix}
                disabled={papers.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-solid-fg rounded text-xs font-medium hover:bg-accent-hover transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generate Matrix from All Papers
              </button>
            </div>
          )}

          {isLoading && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-secondary">
              <div className="space-y-3 w-full max-w-md">
                <div className="flex flex-col items-center gap-2 animate-pulse-subtle">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <h3 className="text-sm font-semibold text-text-primary">Synthesizing Literature Matrix...</h3>
                  <p className="text-xs text-text-secondary max-w-sm text-center">Extracting structured findings, benchmark datasets, and limitation disclosures across selected papers.</p>
                </div>
                {/* Skeleton table */}
                <div className="space-y-2 pt-4">
                  <div className="h-8 bg-sunken rounded skeleton" />
                  {[0,1,2].map(i => <div key={i} className="h-12 bg-sunken rounded skeleton" style={{ animationDelay: `${i*40}ms` }} />)}
                </div>
              </div>
            </div>
          )}

          {matrixData && (
            <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-250">
              {/* Matrix Action Bar */}
              <div className="flex items-center justify-between px-6 py-2.5 border-b border-border-default bg-sunken/40">
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {matrixData.total_papers} Papers Compared
                  </span>
                  <span>·</span>
                  <span>Every cell backed by source passage</span>
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
                        <span>{t('intelligence.exportMd')}</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleDownloadCsv}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-border-default bg-surface text-text-primary hover:bg-sunken transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t('intelligence.exportCsv')}</span>
                  </button>
                  {onInsertIntoDocument && (
                    <button
                      onClick={handleInsert}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-accent text-accent-solid-fg hover:bg-accent-hover transition-colors"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>{t('intelligence.insertMatrix')}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Matrix Table */}
              <div className="flex-1 overflow-auto p-4">
                <table className="w-full border-collapse border border-border-default text-xs text-left">
                  <thead>
                    <tr className="bg-sunken text-text-secondary font-semibold border-b border-border-default">
                      <th className="p-3 border-r border-border-default min-w-[180px]">Paper</th>
                      <th className="p-3 border-r border-border-default min-w-[160px]">Method</th>
                      <th className="p-3 border-r border-border-default min-w-[150px]">Dataset</th>
                      <th className="p-3 border-r border-border-default min-w-[160px]">Results</th>
                      <th className="p-3 min-w-[180px]">Limitations</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {matrixData.rows.map((row, idx) => (
                      <tr key={row.paper_id} style={{ animationDelay: `${Math.min(idx * 40, 280)}ms` }} className="hover:bg-sunken/30 transition-[background-color] duration-150 animate-fade-slide-in">
                        {/* Paper Meta */}
                        <td className="p-3 border-r border-border-default align-top">
                          <div className="font-semibold text-text-primary line-clamp-2">
                            {row.paper_title}
                          </div>
                          <div className="text-[11px] text-text-secondary mt-1">
                            {row.authors} ({row.year || 'n.d.'})
                          </div>
                          {row.doi && (
                            <span className="inline-block font-mono text-[10px] text-accent mt-0.5 truncate max-w-[150px]">
                              {row.doi}
                            </span>
                          )}
                        </td>

                        {/* Method Cell */}
                        <td
                          onClick={() => setInspectedCell({ columnName: 'Method', cell: row.method })}
                          className="p-3 border-r border-border-default align-top cursor-pointer hover:bg-accent/5 group transition-[background-color] duration-150"
                        >
                          <div className="text-text-primary leading-relaxed">{row.method.value}</div>
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-accent font-medium opacity-75 group-hover:opacity-100">
                            <BookOpen className="w-3 h-3" />
                            <span>View passage ↗</span>
                          </div>
                        </td>

                        {/* Dataset Cell */}
                        <td
                          onClick={() =>
                            setInspectedCell({ columnName: 'Dataset', cell: row.dataset })
                          }
                          className="p-3 border-r border-border-default align-top cursor-pointer hover:bg-accent/5 group transition-[background-color] duration-150"
                        >
                          <div className="text-text-primary leading-relaxed">{row.dataset.value}</div>
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-accent font-medium opacity-75 group-hover:opacity-100">
                            <BookOpen className="w-3 h-3" />
                            <span>View passage ↗</span>
                          </div>
                        </td>

                        {/* Results Cell */}
                        <td
                          onClick={() =>
                            setInspectedCell({ columnName: 'Results', cell: row.results })
                          }
                          className="p-3 border-r border-border-default align-top cursor-pointer hover:bg-accent/5 group transition-[background-color] duration-150"
                        >
                          <div className="text-text-primary leading-relaxed">{row.results.value}</div>
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-accent font-medium opacity-75 group-hover:opacity-100">
                            <BookOpen className="w-3 h-3" />
                            <span>View passage ↗</span>
                          </div>
                        </td>

                        {/* Limitations Cell */}
                        <td
                          onClick={() =>
                            setInspectedCell({ columnName: 'Limitations', cell: row.limitations })
                          }
                          className="p-3 align-top cursor-pointer hover:bg-accent/5 group transition-[background-color] duration-150"
                        >
                          <div className="text-text-primary leading-relaxed">
                            {row.limitations.value}
                          </div>
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-accent font-medium opacity-75 group-hover:opacity-100">
                            <BookOpen className="w-3 h-3" />
                            <span>View passage ↗</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

{/* Cell Evidence Inspector Drawer */}
      {(inspectedCell || isInspectorClosing) && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end transition-opacity duration-150 ease-smooth-out data-[state=open]:opacity-100 data-[state=closed]:opacity-0 data-[state=closed]:duration-150 data-[state=closed]:ease-out backdrop-enter" data-state={isInspectorClosing ? 'closed' : 'open'}>
          <div className="w-full max-w-md bg-surface h-full shadow-xl border-l border-border-default flex flex-col p-6 overflow-y-auto transition-[transform,opacity] duration-400 ease-smooth-out data-[state=open]:translate-x-0 data-[state=open]:opacity-100 data-[state=closed]:translate-x_full data-[state=closed]:opacity-0 data-[state=closed]:duration-350 data-[state=closed]:ease-out drawer-enter" data-state={isInspectorClosing ? 'closed' : 'open'} style={{ transitionTimingFunction: 'var(--ease-smooth-out)' }}>
            {inspectedCell && (
              <>
                <div className="flex items-center justify-between pb-4 border-b border-border-default">
                  <div className="flex items-center gap-2 text-accent font-semibold text-sm">
                    <BookOpen className="w-4 h-4" />
                    <span>Source Provenance · {inspectedCell.columnName}</span>
                  </div>
                  <button
                    onClick={handleCloseInspector}
                    className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-sunken"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                      Paper
                    </span>
                    <p className="text-sm font-semibold text-text-primary mt-0.5">
                      {inspectedCell.cell.paper_title}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-text-secondary">
                    <div>
                      <span className="font-semibold text-text-primary">Section:</span>{' '}
                      {inspectedCell.cell.section || 'General'}
                    </div>
                    <div>
                      <span className="font-semibold text-text-primary">Page:</span>{' '}
                      {inspectedCell.cell.page_number || 1}
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                      Matrix Summary
                    </span>
                    <div className="mt-1 p-3 bg-sunken rounded border border-border-default text-xs font-medium text-text-primary">
                      {inspectedCell.cell.value}
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                      Verbatim Source Excerpt
                    </span>
                    <div className="mt-1 p-3.5 bg-accent/5 border border-accent/20 rounded font-serif text-xs text-text-primary leading-relaxed italic">
                      "{inspectedCell.cell.source_excerpt || inspectedCell.cell.value}"
                    </div>
                  </div>
                </div>

                <div className="mt-auto pt-6 border-t border-border-default">
                  <button
                    onClick={handleCloseInspector}
                    className="w-full py-2 bg-sunken hover:bg-border-default text-text-primary rounded text-xs font-medium transition-colors"
                  >
                    Close Inspector
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
