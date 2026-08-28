'use client';

import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { t } from '../../i18n';
import {
  Gauge,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  Info
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@openresearch/ui';

interface ProviderStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ProviderInfo {
  provider_name: string;
  tier: string;
  is_usage_based: boolean;
  requests_made: number;
  requests_remaining?: number;
  monthly_quota?: number;
  cache_hits: number;
  cache_misses: number;
  cache_hit_rate: number;
  status: string;
}

export const ProviderQuotaModal: React.FC<ProviderStatusModalProps> = ({ isOpen, onClose }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [totalCached, setTotalCached] = useState(0);
  const [overallHitRate, setOverallHitRate] = useState(0);
  const [notice, setNotice] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const res = await api.system.getProviderStatus();
      setProviders(res.providers || []);
      setTotalCached(res.total_cached_queries || 0);
      setOverallHitRate(res.overall_cache_hit_rate || 0);
      setNotice(res.notice || '');
    } catch (err) {
      console.warn('Failed to load provider status', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  const handleClearCache = async () => {
    setIsLoading(true);
    try {
      const res = await api.system.clearProviderCache();
      setToastMessage(`Query cache cleared (${res.cleared_entries} entries removed).`);
      await fetchStatus();
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      console.warn('Failed to clear provider cache', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-md bg-accent/10 text-accent">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-text-primary">
                {t('quota.title')}
              </DialogTitle>
              <DialogDescription className="text-xs text-text-secondary mt-0.5">
                {t('quota.subtitle')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Toast */}
        {toastMessage && (
          <div className="mx-6 mt-4 p-2.5 bg-trust-success/10 border border-trust-success/20 text-trust-success rounded text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Cache Stats Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-sunken rounded-lg border border-border-default">
            <div>
              <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                Cached Queries
              </span>
              <p className="text-xl font-bold text-text-primary mt-0.5">{totalCached}</p>
            </div>
            <div>
              <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                Overall Hit Rate
              </span>
              <p className="text-xl font-bold text-accent mt-0.5">
                {Math.round(overallHitRate * 100)}%
              </p>
            </div>
            <div className="flex items-center sm:justify-end">
              <button
                type="button"
                onClick={handleClearCache}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border-default bg-surface text-xs font-semibold text-text-primary hover:bg-trust-warning/10 hover:text-trust-warning hover:border-trust-warning/30 transition-colors focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('quota.clearCache')}</span>
              </button>
            </div>
          </div>

          {/* Providers Table */}
          <div className="border border-border-default rounded-lg overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-sunken text-text-secondary font-semibold border-b border-border-default">
                <tr>
                  <th className="p-3">Provider</th>
                  <th className="p-3">Tier</th>
                  <th className="p-3">Monthly Usage</th>
                  <th className="p-3">Cache Hit Rate</th>
                  <th className="p-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {providers.map((p) => (
                  <tr key={p.provider_name} className="hover:bg-sunken/30">
                    <td className="p-3 font-semibold text-text-primary">{p.provider_name}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-sunken border border-border-default text-text-secondary">
                        {p.tier}
                      </span>
                    </td>
                    <td className="p-3 text-text-secondary">
                      {p.monthly_quota ? (
                        <span>
                          {p.requests_made.toLocaleString()} / {p.monthly_quota.toLocaleString()}
                        </span>
                      ) : (
                        <span>{p.requests_made.toLocaleString()} requests</span>
                      )}
                    </td>
                    <td className="p-3 text-text-secondary">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-sunken rounded-full overflow-hidden border border-border-default">
                          <div
                            className="h-full bg-accent"
                            style={{ width: `${Math.round(p.cache_hit_rate * 100)}%` }}
                          />
                        </div>
                        <span>{Math.round(p.cache_hit_rate * 100)}%</span>
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                          p.status === 'healthy'
                            ? 'bg-trust-success/10 text-trust-success border border-trust-success/20'
                            : 'bg-trust-warning/10 text-trust-warning border border-trust-warning/20'
                        }`}
                      >
                        <ShieldCheck className="w-3 h-3" />
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Quota Notice Banner */}
          <div className="p-3.5 bg-accent/5 border border-accent/20 rounded text-xs text-text-secondary flex items-start gap-2.5">
            <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {notice || t('quota.quotaNotice')}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
