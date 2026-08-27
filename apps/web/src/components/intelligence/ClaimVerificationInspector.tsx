'use client';

import React, { useState, useEffect } from 'react';
import { useDocument } from '../../context/DocumentContext';
import { useProject } from '../../context/ProjectContext';
import { api, ClaimFlagDTO } from '../../lib/api';
import { t } from '../../i18n';
import {
  ShieldAlert,
  Search,
  CheckCircle2,
  AlertTriangle,
  X,
  Sparkles,
  Loader2,
  RefreshCw,
  EyeOff,
  BookOpen
} from 'lucide-react';

export type ClaimFlag = ClaimFlagDTO;

interface ClaimVerificationInspectorProps {
  onFindSources?: (suggestedQuery: string) => void;
  onClose?: () => void;
  onClaimsCounted?: (unsupported: number, total: number) => void;
}

export const ClaimVerificationInspector: React.FC<ClaimVerificationInspectorProps> = ({
  onFindSources,
  onClose,
  onClaimsCounted,
}) => {
  const { activeProject } = useProject();
  const { activeDocument } = useDocument();

  const [isLoading, setIsLoading] = useState(false);
  const [claims, setClaims] = useState<ClaimFlag[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [unsupportedCount, setUnsupportedCount] = useState(0);

  const fetchClaims = async (dismissedList: string[] = dismissedIds) => {
    if (!activeProject || !activeDocument) return;
    setIsLoading(true);
    try {
      const res = await api.intelligence.verifyClaims(activeProject.id, {
        document_id: activeDocument.id,
        text: activeDocument.plain_text || '',
        dismissed_claim_ids: dismissedList,
      });
      setClaims(res.claims);
      setUnsupportedCount(res.unsupported_claims_count);
      const unsupportedFromClaims = res.claims.filter((claim) => !claim.is_dismissed).length;
      onClaimsCounted?.(unsupportedFromClaims, res.total_claims_analyzed);
    } catch (err) {
      console.warn('Failed to verify claims', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeDocument) {
      fetchClaims(dismissedIds);
    }
    // Intentionally keyed on document id only: re-verifying on every dismissedIds
    // or document-object change would re-post the full text on each dismissal/keystroke.
    // Dismissals trigger an explicit fetchClaims(nextDismissed) in handleDismiss.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocument?.id]);

  const handleDismiss = (claimId: string) => {
    const nextDismissed = [...dismissedIds, claimId];
    setDismissedIds(nextDismissed);
    fetchClaims(nextDismissed);
  };

  const handleFindSources = (query: string) => {
    if (onFindSources) {
      onFindSources(query);
    }
  };

  const activeClaims = claims.filter((c) => !c.is_dismissed);

  return (
    <div className="flex flex-col h-full bg-surface border-l border-border-default">
      {/* Header */}
      <div className="p-4 border-b border-border-default flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-trust-warning" />
          <h3 className="text-xs font-semibold text-text-primary">
            {t('intelligence.claims.title')}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchClaims(dismissedIds)}
            disabled={isLoading}
            className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-sunken"
            title="Re-verify document"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-sunken"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scope Disclaimer */}
      <div className="px-4 py-2 bg-trust-warning/10 border-b border-trust-warning/20 text-[11px] text-trust-warning flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>
          Mechanical zero-citation detection. Confidence scoring deferred.
        </span>
      </div>

      {/* Claims List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && (
          <div className="py-8 text-center text-xs text-text-secondary space-y-3">
            <div className="flex flex-col items-center gap-2 animate-pulse-subtle">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-accent" />
              <span>Analyzing empirical assertions...</span>
            </div>
            <div className="space-y-2">
              {[0,1,2].map(i => <div key={i} className="h-16 bg-sunken rounded-lg skeleton" style={{ animationDelay: `${i*40}ms` }} />)}
            </div>
          </div>
        )}

        {!isLoading && activeClaims.length === 0 && (
          <div className="py-8 text-center text-xs text-text-secondary">
            <CheckCircle2 className="w-6 h-6 text-trust-success mx-auto mb-2" />
            <p className="font-medium text-text-primary">No unsupported claims flagged</p>
            <p className="text-[11px] text-text-secondary mt-1">
              All empirical statements in this document have nearby detected citations.
            </p>
          </div>
        )}

        {!isLoading &&
          activeClaims.map((claim, idx) => (
<div
            key={claim.claim_id}
            style={{ animationDelay: `${Math.min(idx * 40, 280)}ms` }}
            className="p-3 rounded-lg border border-trust-warning/30 bg-trust-warning/5 text-xs space-y-2 transition-[transform,box-shadow,border-color] duration-150 hover:shadow-sm [@media(hover:hover)]:hover:-translate-y-px animate-fade-slide-in"
          >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-trust-warning text-[11px] uppercase tracking-wider">
                  No Supporting Citation
                </span>
                <button
                  onClick={() => handleDismiss(claim.claim_id)}
                  className="text-[10px] text-text-secondary hover:text-text-primary hover:underline"
                  title="Mark this sentence as non-factual or intentional"
                >
                  Dismiss
                </button>
              </div>

              <p className="font-serif italic text-text-primary leading-relaxed bg-surface/80 p-2 rounded border border-border-default/60">
                &quot;{claim.text}&quot;
              </p>

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => handleFindSources(claim.suggested_query || claim.text)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-accent text-accent-solid-fg font-medium text-[11px] hover:bg-accent-hover transition-[transform,background-color] duration-150 active:scale-95"
                >
                  <Search className="w-3 h-3" />
                  <span>{t('intelligence.claims.findSources')}</span>
                </button>

                <span className="text-[10px] font-mono text-text-tertiary">
                  query: {claim.suggested_query.slice(0, 20)}...
                </span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};
