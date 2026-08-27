/**
 * OpenResearch Plugin System Interfaces (Roadmap 9.4)
 * Respects the AGPL-3.0 network service boundary.
 */

export type PluginType =
  | 'research_provider'
  | 'ai_provider'
  | 'export_transformer'
  | 'citation_processor'
  | 'editor_extension';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  pluginType: PluginType;
  description?: string;
  author?: string;
  license: string;
  entrypoints?: Record<string, string>;
  settingsSchema?: Record<string, unknown>;
}

export interface PluginConfigRecord {
  id: string;
  plugin_id: string;
  name: string;
  version: string;
  plugin_type: PluginType;
  description?: string;
  author?: string;
  license: string;
  enabled: boolean;
  config_json?: Record<string, unknown>;
  entrypoints?: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface PluginHookExecution {
  plugin_id: string;
  status: 'ok' | 'skipped' | 'error';
  reason?: string;
  error?: string;
}

export interface PluginHookResult {
  hook_name: string;
  plugin_type: PluginType;
  payload: Record<string, unknown>;
  executions: PluginHookExecution[];
}

export interface PluginHookContext {
  documentId?: string;
  projectId?: string;
  userId?: string;
  options?: Record<string, unknown>;
}

export interface PluginLifecycleHooks<TPaper = unknown, TCitation = unknown, TText = unknown, TExport = unknown> {
  onPaperExtract?: (paperData: TPaper, context: PluginHookContext) => Promise<TPaper>;
  onCitationFormat?: (citationData: TCitation, context: PluginHookContext) => Promise<TCitation>;
  onAITransform?: (textData: TText, context: PluginHookContext) => Promise<TText>;
  onExport?: (exportPayload: TExport, context: PluginHookContext) => Promise<TExport>;
}
