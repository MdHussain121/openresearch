'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useProject } from '../../context/ProjectContext';
import { useDocument } from '../../context/DocumentContext';
import { usePaper } from '../../context/PaperContext';
import {
  Upload,
  Download,
  Copy,
  Check,
  FileCode,
  Loader2,
  AlertCircle
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@openresearch/ui';

interface BibtexModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'import' | 'export';
}

export const BibtexModal: React.FC<BibtexModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'import',
}) => {
  const { activeProject } = useProject();
  const { activeDocument } = useDocument();
  const { loadPapers } = usePaper();

  const [activeTab, setActiveTab] = useState<'import' | 'export'>(defaultTab);
  const [bibtexInput, setBibtexInput] = useState('');
  const [exportContent, setExportContent] = useState('');
  const [exportSource, setExportSource] = useState<'document' | 'project'>('document');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab, isOpen]);

  const loadExportBibtex = useCallback(async () => {
    if (!activeProject) return;
    setIsLoading(true);
    setError(null);
    try {
      if (exportSource === 'document' && activeDocument) {
        const res = await api.citations.exportDocumentBibtex(activeDocument.id);
        setExportContent(res.bibtex_content || '% No citations found in active document.');
      } else {
        const res = await api.citations.exportProjectBibtex(activeProject.id);
        setExportContent(res.bibtex_content || '% No papers in project library.');
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to export BibTeX'));
    } finally {
      setIsLoading(false);
    }
  }, [activeProject, activeDocument, exportSource]);

  useEffect(() => {
    if (isOpen && activeTab === 'export') {
      loadExportBibtex();
    }
  }, [isOpen, activeTab, loadExportBibtex]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setBibtexInput(text || '');
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!activeProject || !bibtexInput.trim()) return;
    setIsLoading(true);
    setError(null);
    setStatusMessage(null);

    try {
      const res = await api.citations.importBibtex(activeProject.id, bibtexInput.trim());
      await loadPapers();
      setStatusMessage(`Successfully imported ${res.total_imported} reference(s) into your library.`);
      setBibtexInput('');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to import BibTeX'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!exportContent) return;
    navigator.clipboard.writeText(exportContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!exportContent) return;
    const filename = `${exportSource === 'document' ? (activeDocument?.title || 'document') : (activeProject?.name || 'library')}.bib`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const blob = new Blob([exportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl p-0 flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <DialogHeader className="px-5 py-3.5 bg-surface">
          <div className="flex items-center space-x-2">
            <FileCode className="w-4 h-4 text-accent" />
            <DialogTitle className="font-serif font-bold text-sm text-text-primary">
              {t('bibtexModal.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">Import or export BibTeX citations</DialogDescription>
        </DialogHeader>

        {/* Tabs and Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded border border-trust-danger/30 bg-trust-danger/10 text-trust-danger flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {statusMessage && (
            <div className="p-3 rounded border border-trust-grounded/30 bg-trust-grounded/10 text-trust-grounded flex items-start space-x-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{statusMessage}</span>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'import' | 'export')} className="w-full">
            <TabsList className="w-full grid grid-cols-2 mb-4">
              <TabsTrigger value="import">{t('bibtexModal.importTab')}</TabsTrigger>
              <TabsTrigger value="export">{t('bibtexModal.exportTab')}</TabsTrigger>
            </TabsList>

            <TabsContent value="import" className="space-y-4 mt-0">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-1.5">
                  {t('bibtexModal.uploadFile')}
                </label>
                <input
                  type="file"
                  accept=".bib,.txt"
                  onChange={handleFileUpload}
                  className="block w-full text-xs text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-border-default file:text-xs file:font-medium file:text-text-primary file:bg-sunken hover:file:bg-surface hover:file:text-text-primary cursor-pointer focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-1.5">
                  {t('bibtexModal.orPaste')}
                </label>
                <textarea
                  rows={8}
                  value={bibtexInput}
                  onChange={(e) => setBibtexInput(e.target.value)}
                  placeholder={t('bibtexModal.placeholder')}
                  className="w-full p-3 rounded border border-border-default bg-canvas font-mono text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent leading-relaxed"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={isLoading || !bibtexInput.trim()}
                  className="px-4 py-2 rounded bg-accent text-accent-solid-fg font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center space-x-1.5 transition-colors shadow-2xs focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  <span>{isLoading ? t('bibtexModal.importing') : t('bibtexModal.importButton')}</span>
                </button>
              </div>
            </TabsContent>

            <TabsContent value="export" className="space-y-4 mt-0">
              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-1.5 cursor-pointer text-text-primary">
                  <input
                    type="radio"
                    name="exportSource"
                    checked={exportSource === 'document'}
                    onChange={() => setExportSource('document')}
                    className="text-accent focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <span>{t('bibtexModal.exportDocument')}</span>
                </label>
                <label className="flex items-center space-x-1.5 cursor-pointer text-text-primary">
                  <input
                    type="radio"
                    name="exportSource"
                    checked={exportSource === 'project'}
                    onChange={() => setExportSource('project')}
                    className="text-accent focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <span>{t('bibtexModal.exportProject')}</span>
                </label>
              </div>

              <div className="relative">
                <textarea
                  readOnly
                  rows={10}
                  value={exportContent}
                  className="w-full p-3 rounded border border-border-default bg-canvas font-mono text-xs text-text-primary focus:outline-none leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-3.5 py-1.5 rounded border border-border-default bg-surface hover:bg-sunken text-text-primary font-medium flex items-center space-x-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-trust-grounded" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? t('citations.copied') : t('bibtexModal.copyText')}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-3.5 py-1.5 rounded bg-accent text-accent-solid-fg font-medium hover:bg-accent/90 flex items-center space-x-1.5 transition-colors shadow-2xs focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('bibtexModal.downloadFile')}</span>
                </button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};
