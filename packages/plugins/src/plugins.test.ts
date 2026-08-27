import { describe, it, expect } from 'vitest';
import type { PluginManifest, PluginLifecycleHooks, PluginHookContext } from './types';

describe('Plugins System', () => {
  it('validates plugin manifest structure and hook execution', async () => {
    const manifest: PluginManifest = {
      id: 'custom-export-latex',
      name: 'Custom LaTeX Exporter',
      version: '1.0.0',
      pluginType: 'export_transformer',
      license: 'MIT',
      description: 'Formats documents into specialized IEEE conference LaTeX templates',
      author: 'OpenResearch Labs',
    };

    expect(manifest.id).toBe('custom-export-latex');
    expect(manifest.pluginType).toBe('export_transformer');

    const hooks: PluginLifecycleHooks<unknown, unknown, string, string> = {
      onAITransform: async (text: string, _context: PluginHookContext) => {
        return text.toUpperCase();
      },
      onExport: async (content: string, _context: PluginHookContext) => {
        return `\\documentclass{article}\n${content}`;
      },
    };

    const transformed = await hooks.onAITransform?.('abstract', {});
    expect(transformed).toBe('ABSTRACT');

    const exported = await hooks.onExport?.('Hello World', {});
    expect(exported).toContain('\\documentclass{article}');
  });
});
