import { request } from './client';

export interface AiProviderConfigDTO {
  provider: string;
  label: string;
  configured: boolean;
  masked_key: string | null;
  model: string | null;
  base_url: string | null;
}

export interface AiProvidersResponseDTO {
  active: string | null;
  providers: AiProviderConfigDTO[];
}

export interface AiProviderUpdateDTO {
  api_key?: string;
  model?: string;
  base_url?: string;
  is_active?: boolean;
}

export interface RateLimitDTO {
  rate_limit_rpm: number | null;
}

export const providersApi = {
  list: () => request<AiProvidersResponseDTO>('/ai/providers'),

  update: (provider: string, data: AiProviderUpdateDTO) =>
    request<AiProvidersResponseDTO & { provider: AiProviderConfigDTO }>(`/ai/providers/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  remove: (provider: string) =>
    request<{ status: string; provider: string; active: string | null }>(`/ai/providers/${provider}`, {
      method: 'DELETE',
    }),

  getRateLimit: () => request<RateLimitDTO>('/ai/rate-limit'),

  setRateLimit: (rateLimitRpm: number | null) =>
    request<RateLimitDTO>('/ai/rate-limit', {
      method: 'PUT',
      body: JSON.stringify({ rate_limit_rpm: rateLimitRpm }),
    }),
};
