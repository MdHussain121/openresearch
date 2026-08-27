'use client';

import React, { useState } from 'react';
import { useProject } from '../../context/ProjectContext';
import { usePaper } from '../../context/PaperContext';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { t } from '../../i18n';
import {
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Key,
  User,
  FileJson,
  FolderSync
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

interface ZoteroImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ZoteroImportModal: React.FC<ZoteroImportModalProps> = ({ isOpen, onClose }) => {
  const { activeProject } = useProject();
  const { loadPapers } = usePaper();

  const [activeTab, setActiveTab] = useState<'csl' | 'api'>('csl');
  const [cslContent, setCslContent] = useState('');
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [collectionId, setCollectionId] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleImportCsl = async () => {
    if (!activeProject || !cslContent.trim()) return;
    setIsLoading(true);
    setStatusMessage(null);

    try {
      const res = await api.zotero.import(activeProject.id, {
        csl_json_content: cslContent.trim(),
        collection_id: collectionId.trim() || undefined,
      });
      await loadPapers();
      setStatusMessage({
        type: 'success',
        text: `Successfully imported ${res.total_imported} paper(s) into your library!`,
      });
      setCslContent('');
    } catch (err: unknown) {
      setStatusMessage({
        type: 'error',
        text: getErrorMessage(err, 'Failed to import CSL-JSON references.'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncApi = async () => {
    if (!activeProject || !userId.trim() || !apiKey.trim()) return;
    setIsLoading(true);
    setStatusMessage(null);

    try {
      const res = await api.zotero.sync(activeProject.id, {
        user_id: userId.trim(),
        api_key: apiKey.trim(),
        collection_id: collectionId.trim() || undefined,
      });
      await loadPapers();
      setStatusMessage({
        type: 'success',
        text: `Synced ${res.synced_items_count} item(s) from Zotero!`,
      });
    } catch (err: unknown) {
      setStatusMessage({
        type: 'error',
        text: getErrorMessage(err, 'Failed to connect to Zotero Web API.'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setCslContent(ev.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-md bg-accent/10 text-accent">
              <FolderSync className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-text-primary">
                {t('zoteroModal.title')}
              </DialogTitle>
              <DialogDescription className="text-xs text-text-secondary mt-0.5">
                {t('zoteroModal.subtitle')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Tab Selector & Content */}
        <div className="p-6 space-y-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'csl' | 'api')} className="w-full">
            <TabsList className="w-full grid grid-cols-2 mb-4">
              <TabsTrigger value="csl">{t('zoteroModal.cslTab')}</TabsTrigger>
              <TabsTrigger value="api">{t('zoteroModal.apiTab')}</TabsTrigger>
            </TabsList>

            {/* Status Message */}
            {statusMessage && (
              <div
                className={`mb-4 p-3 rounded text-xs flex items-center gap-2 ${
                  statusMessage.type === 'success'
                    ? 'bg-trust-success/10 text-trust-success border border-trust-success/20'
                    : 'bg-trust-warning/10 text-trust-warning border border-trust-warning/20'
                }`}
              >
                {statusMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{statusMessage.text}</span>
              </div>
            )}

            <TabsContent value="csl" className="space-y-3 mt-0">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-text-primary">
                  {t('zoteroModal.cslJsonLabel')}
                </label>
                <label className="inline-flex items-center gap-1 text-xs text-accent hover:underline cursor-pointer focus-within:ring-2 focus-within:ring-accent rounded">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload .json file</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <textarea
                rows={7}
                placeholder={t('zoteroModal.cslJsonPlaceholder')}
                value={cslContent}
                onChange={(e) => setCslContent(e.target.value)}
                className="w-full text-xs font-mono p-3 rounded border border-border-default bg-sunken text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />

              <button
                type="button"
                onClick={handleImportCsl}
                disabled={isLoading || !cslContent.trim()}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-accent text-accent-solid-fg rounded text-xs font-semibold hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-xs focus-visible:ring-2 focus-visible:ring-accent"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t('zoteroModal.importing')}</span>
                  </>
                ) : (
                  <>
                    <FileJson className="w-3.5 h-3.5" />
                    <span>{t('zoteroModal.importButton')}</span>
                  </>
                )}
              </button>
            </TabsContent>

            <TabsContent value="api" className="space-y-3 mt-0">
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t('zoteroModal.userIdLabel')}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-text-tertiary absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder={t('zoteroModal.userIdPlaceholder')}
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    className="w-full text-xs pl-9 pr-3 py-2 rounded border border-border-default bg-sunken text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t('zoteroModal.apiKeyLabel')}
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 text-text-tertiary absolute left-3 top-2.5" />
                  <input
                    type="password"
                    placeholder={t('zoteroModal.apiKeyPlaceholder')}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full text-xs pl-9 pr-3 py-2 rounded border border-border-default bg-sunken text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t('zoteroModal.collectionLabel')}
                </label>
                <input
                  type="text"
                  placeholder={t('zoteroModal.collectionPlaceholder')}
                  value={collectionId}
                  onChange={(e) => setCollectionId(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded border border-border-default bg-sunken text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <button
                type="button"
                onClick={handleSyncApi}
                disabled={isLoading || !userId.trim() || !apiKey.trim()}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-accent text-accent-solid-fg rounded text-xs font-semibold hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-xs mt-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t('zoteroModal.syncing')}</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{t('zoteroModal.syncButton')}</span>
                  </>
                )}
              </button>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};
