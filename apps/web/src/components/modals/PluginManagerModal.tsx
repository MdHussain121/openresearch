'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api, PluginConfigDTO, PluginManifestDTO } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { t } from '../../i18n';
import {
  Boxes,
  Check,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Settings2,
  Plus,
  FileCode,
  Save
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@openresearch/ui';

interface PluginManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PluginManagerModal: React.FC<PluginManagerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [plugins, setPlugins] = useState<PluginConfigDTO[]>([]);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginConfigDTO | null>(null);
  const [configJsonText, setConfigJsonText] = useState('');
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [manifestText, setManifestText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadPlugins = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await api.plugins.list();
      setPlugins(list);
      if (list.length > 0 && !selectedPlugin) {
        setSelectedPlugin(list[0] || null);
        setConfigJsonText(JSON.stringify(list[0]?.config_json || {}, null, 2));
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load plugins'));
    } finally {
      setIsLoading(false);
    }
  }, [selectedPlugin]);

  useEffect(() => {
    if (isOpen) {
      loadPlugins();
    }
  }, [isOpen, loadPlugins]);

  const handleSelectPlugin = (p: PluginConfigDTO) => {
    setSelectedPlugin(p);
    setShowRegisterForm(false);
    setConfigJsonText(JSON.stringify(p.config_json || {}, null, 2));
    setError(null);
    setSuccessMsg(null);
  };

  const handleToggle = async (pluginId: string, currentEnabled: boolean) => {
    try {
      const updated = await api.plugins.toggle(pluginId, !currentEnabled);
      setPlugins((prev) => prev.map((p) => (p.plugin_id === pluginId ? updated : p)));
      if (selectedPlugin?.plugin_id === pluginId) {
        setSelectedPlugin(updated);
      }
      setSuccessMsg(`Plugin ${!currentEnabled ? 'enabled' : 'disabled'}`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not toggle plugin'));
    }
  };

  const handleSaveConfig = async () => {
    if (!selectedPlugin) return;
    try {
      const parsed = JSON.parse(configJsonText);
      const updated = await api.plugins.updateConfig(selectedPlugin.plugin_id, parsed);
      setPlugins((prev) =>
        prev.map((p) => (p.plugin_id === selectedPlugin.plugin_id ? updated : p))
      );
      setSelectedPlugin(updated);
      setSuccessMsg(t('plugins.configSaved'));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Invalid JSON syntax'));
    }
  };

  const handleRegisterPlugin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const manifest: PluginManifestDTO = JSON.parse(manifestText);
      const registered = await api.plugins.register(manifest);
      setPlugins((prev) => [registered, ...prev]);
      setSelectedPlugin(registered);
      setShowRegisterForm(false);
      setSuccessMsg(`Plugin "${registered.name}" registered successfully!`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Invalid manifest JSON'));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl p-0 flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-accent/10 text-accent rounded-lg">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-semibold text-lg">{t('plugins.title')}</DialogTitle>
              <DialogDescription className="text-xs text-text-secondary">{t('plugins.subtitle')}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="grid grid-cols-1 md:grid-cols-3 flex-1 overflow-y-auto md:overflow-hidden">
          {/* Left: Plugin List */}
          <div className="border-r border-border-default bg-sunken/20 p-4 flex flex-col gap-2 overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                {t('plugins.installed')} ({plugins.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowRegisterForm(true);
                  setManifestText(
                    JSON.stringify(
                      {
                        id: 'custom-export-plugin',
                        name: 'Custom Markdown Exporter',
                        version: '1.0.0',
                        plugin_type: 'export_transformer',
                        description: 'Exports paper drafts into Hugo/Jekyll frontmatter formats.',
                        author: 'Community Contributor',
                        license: 'MIT',
                        settings_schema: { include_date: true },
                      },
                      null,
                      2
                    )
                  );
                }}
                className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                <Plus className="w-3.5 h-3.5" />
                Register
              </button>
            </div>

            {plugins.map((p) => {
              const isSelected = selectedPlugin?.plugin_id === p.plugin_id && !showRegisterForm;
              return (
                <div
                  key={p.id}
                  onClick={() => handleSelectPlugin(p)}
                  className={`p-3 rounded-lg border transition-[background-color,border-color,box-shadow] duration-150 text-xs flex flex-col gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'border-accent bg-accent/5 font-medium'
                      : 'border-border-default bg-surface hover:bg-sunken/60 text-text-secondary'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary truncate">{p.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggle(p.plugin_id, p.enabled);
                      }}
                      className={`p-0.5 rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                        p.enabled ? 'text-accent' : 'text-text-secondary opacity-50'
                      }`}
                    >
                      {p.enabled ? (
                        <ToggleRight className="w-5 h-5" />
                      ) : (
                        <ToggleLeft className="w-5 h-5" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-sunken font-mono text-text-tertiary capitalize">
                      {p.plugin_type.replace('_', ' ')}
                    </span>
                    <span className="text-text-tertiary">v{p.version}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Plugin Details & Settings */}
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

            {showRegisterForm ? (
              <form onSubmit={handleRegisterPlugin} className="flex flex-col gap-4">
                <h3 className="font-semibold text-sm text-text-primary flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-accent" />
                  Register AGPL-Compliant Plugin Manifest
                </h3>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Manifest JSON
                  </label>
                  <textarea
                    rows={12}
                    value={manifestText}
                    onChange={(e) => setManifestText(e.target.value)}
                    className="w-full font-mono text-xs p-3 rounded-lg border border-border-default bg-surface text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent leading-5"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRegisterForm(false)}
                    className="px-3 py-1.5 text-xs text-text-secondary rounded-lg border border-border-default focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs bg-accent text-accent-solid-fg rounded-lg hover:bg-accent-hover font-medium focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Install Plugin
                  </button>
                </div>
              </form>
            ) : selectedPlugin ? (
              <div className="flex flex-col gap-5">
                {/* Header info */}
                <div className="border-b border-border-default pb-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-base text-text-primary">{selectedPlugin.name}</h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        selectedPlugin.enabled
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'bg-sunken text-text-secondary'
                      }`}
                    >
                      {selectedPlugin.enabled ? t('plugins.active') : t('plugins.disabled')}
                    </span>
                  </div>

                  <p className="text-xs text-text-secondary leading-relaxed">
                    {selectedPlugin.description}
                  </p>

                  <div className="flex items-center gap-4 text-[11px] text-text-tertiary pt-1">
                    <span>
                      <strong>Author:</strong> {selectedPlugin.author}
                    </span>
                    <span>
                      <strong>License:</strong> {selectedPlugin.license}
                    </span>
                    <span>
                      <strong>Type:</strong> {selectedPlugin.plugin_type}
                    </span>
                  </div>
                </div>

                {/* Configuration editor */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                    <Settings2 className="w-3.5 h-3.5 text-accent" />
                    Plugin Settings (JSON)
                  </span>

                  <textarea
                    rows={8}
                    value={configJsonText}
                    onChange={(e) => setConfigJsonText(e.target.value)}
                    className="w-full font-mono text-xs p-3 rounded-lg border border-border-default bg-surface text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent leading-5"
                  />

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveConfig}
                      className="px-3 py-1.5 text-xs bg-accent text-accent-solid-fg rounded-lg hover:bg-accent-hover font-medium flex items-center gap-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {t('plugins.saveConfig')}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-text-secondary text-xs">
                Select a plugin to view details and configure settings.
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
      </DialogContent>
    </Dialog>
  );
};
