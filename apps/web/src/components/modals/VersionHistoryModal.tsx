'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api, DocumentVersionDTO, VersionDiffDTO } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { t } from '../../i18n';
import { ConfirmDialog } from './ConfirmDialog';
import {
  History,
  RotateCcw,
  User,
  GitCommit,
  Check,
  AlertCircle,
  FileText,
  SplitSquareVertical
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@openresearch/ui';

interface VersionHistoryModalProps {
  isOpen: boolean;
  documentId: string;
  currentTitle: string;
  onClose: () => void;
  onVersionRestored?: () => void;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  documentId,
  currentTitle,
  onClose,
  onVersionRestored,
}) => {
  const [versions, setVersions] = useState<DocumentVersionDTO[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<DocumentVersionDTO | null>(null);
  const [diffData, setDiffData] = useState<VersionDiffDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{ id: string; num: number } | null>(null);

  const loadDiff = useCallback(async (v1Id: string, v2Id: string) => {
    try {
      const diff = await api.versions.diff(documentId, v1Id, v2Id);
      setDiffData(diff);
    } catch {
      setDiffData(null);
    }
  }, [documentId]);

  const loadVersions = useCallback(async () => {
    if (!documentId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.versions.list(documentId);
      setVersions(data);
      if (data.length > 0) {
        setSelectedVersion(data[0] || null);
        if (data.length > 1 && data[0] && data[1]) {
          loadDiff(data[1].id, data[0].id);
        }
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load version history'));
    } finally {
      setIsLoading(false);
    }
  }, [documentId, loadDiff]);

  useEffect(() => {
    if (isOpen) {
      loadVersions();
    }
  }, [isOpen, documentId, loadVersions]);

  const handleSelectVersion = (version: DocumentVersionDTO, prevVersion?: DocumentVersionDTO) => {
    setSelectedVersion(version);
    if (prevVersion) {
      loadDiff(prevVersion.id, version.id);
    } else {
      setDiffData(null);
    }
  };

  const handleRestore = async (versionId: string, verNum: number) => {
    setIsRestoring(true);
    setError(null);
    try {
      await api.versions.restore(documentId, versionId);
      setSuccessMsg(t('collaboration.restoredToast').replace('{version}', String(verNum)));
      await loadVersions();
      if (onVersionRestored) {
        onVersionRestored();
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not restore revision'));
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl p-0 flex flex-col max-h-[88vh] overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-accent/10 text-accent rounded-lg">
              <History className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-semibold text-lg">{t('collaboration.versionHistory')}</DialogTitle>
              <DialogDescription className="text-xs text-text-secondary">{currentTitle}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 flex-1 overflow-hidden">
          {/* Left: Versions Timeline */}
          <div className="border-r border-border-default bg-sunken/20 p-4 flex flex-col gap-2 overflow-y-auto">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">
              Revisions ({versions.length})
            </span>

            {versions.length === 0 && !isLoading && (
              <div className="text-center py-8 text-xs text-text-secondary">
                No saved versions yet. Revisions are created automatically as you write.
              </div>
            )}

            {versions.map((ver, idx) => {
              const prevVer = versions[idx + 1];
              const isSelected = selectedVersion?.id === ver.id;
              const formattedDate = new Date(ver.created_at).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <button
                  key={ver.id}
                  type="button"
                  onClick={() => handleSelectVersion(ver, prevVer)}
                  className={`w-full text-left p-3 rounded-lg border transition-[background-color,border-color,box-shadow] duration-150 text-xs flex flex-col gap-1.5 focus-visible:ring-2 focus-visible:ring-accent ${
                    isSelected
                      ? 'border-accent bg-accent/5 font-medium'
                      : 'border-border-default bg-surface hover:bg-sunken/60 text-text-secondary'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary flex items-center gap-1.5">
                      <GitCommit className="w-3.5 h-3.5 text-accent" />
                      Version {ver.version_number}
                    </span>
                    <span className="text-[10px] text-text-tertiary">{formattedDate}</span>
                  </div>

                  <span className="text-[11px] text-text-secondary line-clamp-1">
                    {ver.change_summary || 'Snapshot revision'}
                  </span>

                  <div className="flex items-center gap-1 text-[10px] text-text-tertiary">
                    <User className="w-3 h-3" />
                    <span>{ver.author_name}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: Snapshot & Visual Diff View */}
          <div className="md:col-span-2 p-6 overflow-y-auto flex flex-col gap-4">
            {error && (
              <div className="p-3 bg-trust-danger/10 border border-trust-danger/30 rounded-lg text-xs text-trust-danger flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3 bg-trust-success/10 border border-trust-success/30 rounded-lg text-xs text-trust-success flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {selectedVersion ? (
              <div className="flex flex-col gap-4">
                {/* Version details bar */}
                <div className="flex items-center justify-between border-b border-border-default pb-3">
                  <div>
                    <h3 className="font-semibold text-sm text-text-primary flex items-center gap-2">
                      <FileText className="w-4 h-4 text-accent" />
                      Version {selectedVersion.version_number}: {selectedVersion.title}
                    </h3>
                    <p className="text-[11px] text-text-secondary mt-0.5">
                      Authored by {selectedVersion.author_name} on{' '}
                      {new Date(selectedVersion.created_at).toLocaleString()}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPendingRestore({ id: selectedVersion.id, num: selectedVersion.version_number })}
                    disabled={isRestoring}
                    className="px-3 py-1.5 text-xs bg-accent text-accent-solid-fg rounded-lg hover:bg-accent-hover font-medium flex items-center gap-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t('collaboration.restoreVersion')}
                  </button>
                </div>

                {/* Diff summary badge if available */}
                {diffData && (
                  <div className="p-2.5 bg-sunken/40 border border-border-default rounded-lg text-xs flex items-center justify-between">
                    <span className="font-medium text-text-secondary flex items-center gap-1.5">
                      <SplitSquareVertical className="w-3.5 h-3.5 text-accent" />
                      Compared to Version {diffData.v1_version}
                    </span>
                    <span className="text-[11px] font-mono text-accent">
                      {diffData.diff_summary}
                    </span>
                  </div>
                )}

                {/* Content / Diff display */}
                <div className="border border-border-default rounded-xl p-4 bg-surface max-h-[380px] overflow-y-auto font-serif text-sm leading-relaxed whitespace-pre-wrap">
                  {diffData && diffData.diff_items ? (
                    <div className="font-mono text-xs leading-5">
                      {diffData.diff_items.map((item: { change_type: string; text: string }, i: number) => {
                        if (item.change_type === 'insert') {
                          return (
                            <span
                              key={i}
                              className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 px-0.5 rounded"
                            >
                              {item.text}
                            </span>
                          );
                        } else if (item.change_type === 'delete') {
                          return (
                            <span
                              key={i}
                              className="bg-rose-500/15 text-rose-800 dark:text-rose-300 line-through px-0.5 rounded"
                            >
                              {item.text}
                            </span>
                          );
                        }
                        return <span key={i}>{item.text}</span>;
                      })}
                    </div>
                  ) : (
                    <div>{selectedVersion.plain_text || 'Empty document content.'}</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-text-secondary text-xs">
                Select a version on the left to preview its content.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded-lg border border-border-default text-text-secondary hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t('common.close')}
          </button>
        </DialogFooter>

        <ConfirmDialog
          isOpen={pendingRestore !== null}
          title={t('collaboration.restoreVersion')}
          description={t('collaboration.restoreConfirm')}
          confirmLabel={t('collaboration.restoreVersion')}
          destructive={false}
          onConfirm={() => {
            if (pendingRestore) {
              handleRestore(pendingRestore.id, pendingRestore.num);
            }
            setPendingRestore(null);
          }}
          onCancel={() => setPendingRestore(null)}
        />
      </DialogContent>
    </Dialog>
  );
};
