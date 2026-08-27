/**
 * Research Provider types
 */

import { BibliographicReference } from '@openresearch/citations';

export interface SearchOptions {
  limit?: number;
  offset?: number;
  yearStart?: number;
  yearEnd?: number;
  openAccessOnly?: boolean;
}

export interface SearchResult {
  totalResults: number;
  results: BibliographicReference[];
  providerName: string;
}

export interface QuotaStatus {
  providerName: string;
  requestsRemaining?: number;
  monthlyLimit?: number;
  monthlyUsed?: number;
  resetsAt?: Date;
  isUsageBased: boolean;
  tier: 'free' | 'paid' | 'custom';
  cacheHitRate?: number;
  status: 'healthy' | 'warning' | 'exceeded';
}

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}

export interface ProviderCacheStats {
  hits: number;
  misses: number;
  size: number;
}

