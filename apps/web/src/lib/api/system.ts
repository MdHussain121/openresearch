import { request } from './client';

export interface ProviderMetricDTO {
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

export interface SystemProviderStatusDTO {
  providers: ProviderMetricDTO[];
  total_cached_queries: number;
  overall_cache_hit_rate: number;
  notice: string;
}

export interface ProviderCacheClearDTO {
  cleared_entries: number;
  status: string;
}

export const systemApi = {
  getProviderStatus: () => request<SystemProviderStatusDTO>('/system/provider-status'),
  clearProviderCache: () =>
    request<ProviderCacheClearDTO>('/system/provider-cache/clear', {
      method: 'POST',
    }),
};
