'use client';

import React, { useState, useEffect } from 'react';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useDocument } from '../../context/DocumentContext';
import {
  Download,
  FileType,
  FileText,
  BookOpen,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Info
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@openresearch/ui';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  documentTitle: string;
  wordCount: number;
  citationCount: number;
  initialCitationStyle?: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  documentId,
  documentTitle,
  wordCount,
  citationCount,
  initialCitationStyle = 'apa',
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'docx' | 'pdf' | 'markdown' | 'bibtex'>('docx');
  const [selectedStyle, setSelectedStyle] = useState<string>(initialCitationStyle);
  const [includeBibliography, setIncludeBibliography] = useState(true);
  const [includeTrustMarkers, setIncludeTrustMarkers] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const { syncLocalDocument } = useDocument();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialCitationStyle) {
      setSelectedStyle(initialCitationStyle);
    }
  }, [initialCitationStyle]);

  useEffect(() => {
    if (!isOpen) {
      setExportSuccess(false);
      setErrorMessage(null);
    }
  }, [isOpen]);

  const handleExport = async () => {
    setIsExporting(true);
    setErrorMessage(null);
    setExportSuccess(false);

    try {
      if (!documentId) {
        throw new Error('No document is open. Create or select a document first.');
      }

      // Documents created while offline only exist in localStorage (`local-*`
      // ids); sync them to the server first so the export API can find them.
      let exportId = documentId;
      if (documentId.startsWith('local-')) {
        const synced = await syncLocalDocument(documentId);
        if (!synced) {
          throw new Error(
            'This document is stored locally and the server is unreachable, so it cannot be exported yet. Reconnect to the server and try again.'
          );
        }
        exportId = synced.id;
      }

      const { filename, blob } = await api.export.download(exportId, {
        export_format: selectedFormat,
        citation_style: selectedStyle,
        include_bibliography: includeBibliography,
        include_trust_markers: includeTrustMarkers,
      });

      // Trigger native browser download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(() => {
        setIsExporting(false);
      }, 500);
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, 'Export generation failed. Please retry.'));
      setIsExporting(false);
    }
  };

  const formatOptions = [
    {
      id: 'docx' as const,
      title: t('exportModal.docxTitle'),
      ext: '.docx',
      description: t('exportModal.docxDesc'),
      icon: <FileType className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
      badge: 'Word Academic Standard',
    },
    {
      id: 'pdf' as const,
      title: t('exportModal.pdfTitle'),
      ext: '.pdf',
      description: t('exportModal.pdfDesc'),
      icon: <FileText className="w-5 h-5 text-red-600 dark:text-red-400" />,
      badge: 'Camera-Ready Paper',
    },
    {
      id: 'markdown' as const,
      title: t('exportModal.markdownTitle'),
      ext: '.md',
      description: t('exportModal.markdownDesc'),
      icon: <BookOpen className="w-5 h-5 text-accent" />,
      badge: 'MathTeX & GitHub Flavour',
    },
    {
      id: 'bibtex' as const,
      title: t('exportModal.bibtexTitle'),
      ext: '.bib',
      description: t('exportModal.bibtexDesc'),
      icon: <Download className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
      badge: 'BibTeX Bibliography',
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl p-0 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header Bar */}
        <DialogHeader className="px-6 py-4">
          <div className="flex items-center space-x-2">
            <Download className="w-5 h-5 text-accent" />
            <div>
              <DialogTitle className="font-serif font-bold text-base text-text-primary">
                {t('exportModal.title')}
              </DialogTitle>
              <DialogDescription className="text-xs text-text-tertiary">
                {t('exportModal.subtitle')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Format Selection Cards Grid */}
          <div className="space-y-2">
            <label className="block font-semibold text-text-primary uppercase tracking-wider text-[11px]">
              {t('exportModal.formatLabel')}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {formatOptions.map((fmt) => {
                const isSelected = selectedFormat === fmt.id;
                return (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setSelectedFormat(fmt.id)}
                    className={`p-3 rounded-lg border text-left flex flex-col justify-between transition-[background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-accent outline-none ${
                      isSelected
                        ? 'border-accent bg-accent/5 shadow-xs ring-1 ring-accent'
                        : 'border-border-default bg-sunken/40 hover:bg-surface hover:border-border-default'
                    }`}
                  >
                    <div className="flex items-start justify-between w-full mb-2">
                      <div className="flex items-center space-x-2">
                        {fmt.icon}
                        <span className="font-bold text-text-primary">{fmt.title}</span>
                      </div>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />}
                    </div>
                    <p className="text-[11px] text-text-secondary leading-relaxed mb-2">
                      {fmt.description}
                    </p>
                    <span className="inline-block self-start font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border-default text-text-tertiary">
                      {fmt.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Citation Style Selector (for DOCX, PDF, Markdown) */}
          {selectedFormat !== 'bibtex' && (
            <div className="space-y-2 pt-2 border-t border-border-default/60">
              <label htmlFor="citation-style-select" className="block font-semibold text-text-primary uppercase tracking-wider text-[11px]">
                {t('exportModal.styleLabel')}
              </label>
              <select
                id="citation-style-select"
                value={selectedStyle}
                onChange={(e) => setSelectedStyle(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-border-default bg-sunken text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-xs"
              >
                <option value="apa">{t('citations.styles.apa')}</option>
                <option value="mla">{t('citations.styles.mla')}</option>
                <option value="chicago">{t('citations.styles.chicago')}</option>
                <option value="chicago-notes">{t('citations.styles.chicagoNotes')}</option>
                <option value="ieee">{t('citations.styles.ieee')}</option>
                <option value="harvard">{t('citations.styles.harvard')}</option>
                <option value="vancouver">{t('citations.styles.vancouver')}</option>
                <option value="nature">{t('citations.styles.nature')}</option>
                <option value="science">{t('citations.styles.science')}</option>
                <option value="acm">{t('citations.styles.acm')}</option>
                <option value="acs">{t('citations.styles.acs')}</option>
                <option value="turabian">{t('citations.styles.turabian')}</option>
                <option value="ama">{t('citations.styles.ama')}</option>
                <option value="nlm">{t('citations.styles.nlm')}</option>
                <option value="cse">{t('citations.styles.cse')}</option>
                <option value="apsa">{t('citations.styles.apsa')}</option>
                <option value="asa">{t('citations.styles.asa')}</option>
                <option value="aaa">{t('citations.styles.aaa')}</option>
                <option value="mhra">{t('citations.styles.mhra')}</option>
                <option value="oxford">{t('citations.styles.oxford')}</option>
                <option value="oscola">{t('citations.styles.oscola')}</option>
                <option value="bluebook">{t('citations.styles.bluebook')}</option>
                <option value="abnt">{t('citations.styles.abnt')}</option>
                <option value="iso690">{t('citations.styles.iso690')}</option>
                <option value="gbt7714">{t('citations.styles.gbt7714')}</option>
                <option value="cell">{t('citations.styles.cell')}</option>
              </select>
            </div>
          )}

          {/* Options Toggles (Bibliography & Trust Footnotes) */}
          {selectedFormat !== 'bibtex' && (
            <div className="space-y-3 pt-2 border-t border-border-default/60">
              <label className="block font-semibold text-text-primary uppercase tracking-wider text-[11px]">
                {t('exportModal.optionsLabel')}
              </label>
              <div className="space-y-2">
                <label className="flex items-center justify-between p-2.5 rounded border border-border-default bg-sunken/40 hover:bg-surface cursor-pointer">
                  <div className="pr-4">
                    <div className="font-medium text-text-primary">{t('exportModal.includeBib')}</div>
                    <div className="text-[11px] text-text-tertiary">
                      Appends a formatted references section adhering to {selectedStyle.toUpperCase()} rules
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={includeBibliography}
                    onChange={(e) => setIncludeBibliography(e.target.checked)}
                    className="rounded border-border-default text-accent focus:ring-accent w-4 h-4"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 rounded border border-border-default bg-sunken/40 hover:bg-surface cursor-pointer">
                  <div className="pr-4">
                    <div className="font-medium text-text-primary">{t('exportModal.includeTrust')}</div>
                    <div className="text-[11px] text-text-tertiary">
                      Degrades visual trust superscripts into academic footnote citations with passage provenance (UI/UX §5.2)
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={includeTrustMarkers}
                    onChange={(e) => setIncludeTrustMarkers(e.target.checked)}
                    className="rounded border-border-default text-accent focus:ring-accent w-4 h-4"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Document Summary Card */}
          <div className="p-3 rounded-md border border-border-default bg-sunken/70 flex items-center justify-between text-text-secondary text-[11px]">
            <div className="space-y-0.5 truncate pr-2">
              <div className="font-semibold text-text-primary truncate">{documentTitle || 'Untitled Paper'}</div>
              <div className="flex items-center space-x-2 text-text-tertiary">
                <span>{wordCount} words</span>
                <span>•</span>
                <span>{citationCount} citations</span>
                <span>•</span>
                <span className="uppercase font-mono text-accent">{selectedFormat.toUpperCase()}</span>
              </div>
            </div>
            <div className="flex items-center space-x-1 text-accent font-medium shrink-0">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>WCAG Verified</span>
            </div>
          </div>

          {/* Feedback & Errors */}
          {errorMessage && (
            <div className="p-2.5 rounded border border-trust-danger/30 bg-trust-danger/10 text-trust-danger text-xs">
              {errorMessage}
            </div>
          )}
          {exportSuccess && (
            <div className="p-2.5 rounded border border-trust-success/30 bg-trust-success/10 text-trust-success text-xs flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{t('exportModal.downloadReady')}</span>
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <DialogFooter className="px-6 py-3 items-center justify-between">
          <div className="text-[11px] text-text-tertiary hidden sm:flex items-center space-x-1">
            <Info className="w-3 h-3" />
            <span>{t('exportModal.shortcutHint')}</span>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs rounded border border-border-default hover:bg-surface text-text-secondary transition-colors focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="px-5 py-2 text-xs rounded bg-accent text-accent-solid-fg font-medium hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent flex items-center space-x-2 shadow-xs disabled:opacity-50 transition-colors"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t('exportModal.exporting')}</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('exportModal.exportButton')}</span>
                </>
              )}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
