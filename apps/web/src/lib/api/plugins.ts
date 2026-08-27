import { request } from './client';
import type { PluginConfigRecord, PluginHookResult, PluginManifest } from '@openresearch/plugins';

export type PluginConfigDTO = PluginConfigRecord;
export type PluginManifestDTO = PluginManifest;

export const pluginsApi = {
  list: () => request<PluginConfigDTO[]>('/plugins'),
  get: (pluginId: string) => request<PluginConfigDTO>(`/plugins/${pluginId}`),
  register: (manifest: PluginManifestDTO) =>
    request<PluginConfigDTO>('/plugins/register', {
      method: 'POST',
      body: JSON.stringify(manifest),
    }),
  toggle: (pluginId: string, enabled: boolean) =>
    request<PluginConfigDTO>(`/plugins/${pluginId}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  updateConfig: (pluginId: string, configJson: Record<string, unknown>) =>
    request<PluginConfigDTO>(`/plugins/${pluginId}/config`, {
      method: 'PATCH',
      body: JSON.stringify({ config_json: configJson }),
    }),
  executeHook: (hookName: string, payload: Record<string, unknown>) =>
    request<PluginHookResult>(`/plugins/hooks/${hookName}`, {
      method: 'POST',
      body: JSON.stringify({ payload }),
    }),
};
