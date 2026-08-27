import { request } from './client';

export type AutocompleteEngine = 'auto' | 'tabby' | 'cloud' | 'ollama';

export interface AutocompleteSettingsDTO {
  enabled: boolean;
  engine: AutocompleteEngine;
  base_url: string | null;
  model: string | null;
}

export interface AutocompleteSettingsUpdateDTO {
  enabled?: boolean;
  engine?: AutocompleteEngine;
  base_url?: string;
  model?: string;
}

export interface AutocompleteProbeDTO {
  reachable: boolean;
  base_url: string | null;
}

export interface TabbySetupStatusDTO {
  installed: boolean;
  version: string | null;
  reachable: boolean;
}

export interface TabbySetupResultDTO {
  installed: boolean;
  version: string | null;
  reachable: boolean;
  message: string;
  log_tail?: string[];
}

export const autocompleteSettingsApi = {
  get: () => request<AutocompleteSettingsDTO>('/ai/autocomplete-settings'),

  update: (data: AutocompleteSettingsUpdateDTO) =>
    request<AutocompleteSettingsDTO>('/ai/autocomplete-settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  probe: () =>
    request<AutocompleteProbeDTO>('/ai/autocomplete-settings/probe', {
      method: 'POST',
    }),

  setupStatus: () => request<TabbySetupStatusDTO>('/ai/autocomplete-settings/status'),

  setup: () =>
    request<TabbySetupResultDTO>('/ai/autocomplete-settings/setup', {
      method: 'POST',
    }),
};
