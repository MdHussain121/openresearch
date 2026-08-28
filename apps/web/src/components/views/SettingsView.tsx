'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Boxes, Settings as SettingsIcon } from 'lucide-react';
import { ViewHeader } from '../shell/ViewHeader';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@openresearch/ui';
import { useWorkspace } from '../../context/WorkspaceContext';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import type { AiProviderConfigDTO } from '../../lib/api/providers';
import type { AutocompleteSettingsDTO } from '../../lib/api/autocompleteSettings';

export const SettingsView: React.FC = () => {
  const w = useWorkspace();

  // AI Provider API Keys (local settings, no login required)
  const [aiProviders, setAiProviders] = useState<AiProviderConfigDTO[]>([]);
  const [activeAiProvider, setActiveAiProvider] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<
    Record<string, { apiKey: string; model: string; baseUrl: string }>
  >({});
  const [providerStatusMessage, setProviderStatusMessage] = useState('');
  const [rateLimitDraft, setRateLimitDraft] = useState('');
  const [savedRateLimitRpm, setSavedRateLimitRpm] = useState<number | null>(null);

  // Tabby (local) autocomplete settings
  const [acSettings, setAcSettings] = useState<AutocompleteSettingsDTO | null>(null);
  const [acDraft, setAcDraft] = useState<{ baseUrl: string; model: string }>({
    baseUrl: '',
    model: '',
  });
  const [acStatusMessage, setAcStatusMessage] = useState('');
  const [acProbeState, setAcProbeState] = useState<'idle' | 'checking' | 'up' | 'down'>('idle');
  const [isSettingUpTabby, setIsSettingUpTabby] = useState(false);

  // AI Provider API Keys: load + mutate local provider configuration
  const applyProviderList = useCallback(
    (data: { active: string | null; providers: AiProviderConfigDTO[] }) => {
      setAiProviders(data.providers);
      setActiveAiProvider(data.active);
      setProviderDrafts((prev) => {
        const next = { ...prev };
        for (const p of data.providers) {
          if (!next[p.provider]) {
            next[p.provider] = {
              apiKey: '',
              model: p.model || '',
              baseUrl: p.base_url || '',
            };
          }
        }
        return next;
      });
    },
    []
  );

  useEffect(() => {
    api.providers
      .list()
      .then(applyProviderList)
      .catch(() => {
        // Backend offline; settings stay empty rather than blocking the UI.
      });
  }, [applyProviderList]);

  const handleSaveProvider = useCallback(
    async (provider: string, requiresBaseUrl: boolean) => {
      const draft = providerDrafts[provider];
      if (!draft) return;
      setProviderStatusMessage('');
      try {
        const payload: Record<string, unknown> = {
          model: draft.model || undefined,
          is_active: true,
        };
        if (draft.apiKey.trim()) payload.api_key = draft.apiKey.trim();
        if (requiresBaseUrl) payload.base_url = draft.baseUrl.trim();
        const res = await api.providers.update(provider, payload);
        applyProviderList(res);
        setProviderDrafts((prev) => ({ ...prev, [provider]: { ...prev[provider], apiKey: '' } }));
        setProviderStatusMessage(`Saved configuration for ${provider}.`);
      } catch (err) {
        setProviderStatusMessage(
          err instanceof Error ? err.message : `Could not save ${provider} settings.`
        );
      }
    },
    [providerDrafts, applyProviderList]
  );

  const handleClearProvider = useCallback(async (provider: string) => {
    setProviderStatusMessage('');
    try {
      const res = await api.providers.remove(provider);
      setActiveAiProvider(res.active);
      setAiProviders((prev) =>
        prev.map((p) =>
          p.provider === provider
            ? { ...p, configured: false, masked_key: null, model: null, base_url: null }
            : p
        )
      );
      setProviderStatusMessage(`Removed API key for ${provider}.`);
    } catch (err) {
      setProviderStatusMessage(
        err instanceof Error ? err.message : `Could not remove ${provider} key.`
      );
    }
  }, []);

  const updateProviderDraft = useCallback(
    (provider: string, field: 'apiKey' | 'model' | 'baseUrl', value: string) => {
      setProviderDrafts((prev) => ({
        ...prev,
        [provider]: { ...(prev[provider] || { apiKey: '', model: '', baseUrl: '' }), [field]: value },
      }));
    },
    []
  );

  useEffect(() => {
    api.providers
      .getRateLimit()
      .then((data) => {
        setSavedRateLimitRpm(data.rate_limit_rpm);
        setRateLimitDraft(data.rate_limit_rpm != null ? String(data.rate_limit_rpm) : '');
      })
      .catch(() => {
        // Backend offline; leave the field empty rather than blocking the UI.
      });
  }, []);

  const handleSaveRateLimit = useCallback(async () => {
    setProviderStatusMessage('');
    const rpmText = rateLimitDraft.trim();
    let rpm: number | null = null;
    if (rpmText !== '') {
      rpm = Number(rpmText);
      if (!Number.isInteger(rpm) || rpm < 0) {
        setProviderStatusMessage('Rate limit must be a non-negative whole number of requests/minute.');
        return;
      }
    }
    try {
      const res = await api.providers.setRateLimit(rpm);
      setSavedRateLimitRpm(res.rate_limit_rpm);
      setProviderStatusMessage(
        res.rate_limit_rpm != null
          ? `Global cloud rate limit set to ${res.rate_limit_rpm} requests/minute.`
          : 'Global cloud rate limit removed (unlimited).'
      );
    } catch (err) {
      setProviderStatusMessage(err instanceof Error ? err.message : 'Could not save the rate limit.');
    }
  }, [rateLimitDraft]);

  // Tabby autocomplete settings: load, save, health-probe
  useEffect(() => {
    api.autocompleteSettings
      .get()
      .then((data) => {
        setAcSettings(data);
        setAcDraft({ baseUrl: data.base_url || '', model: data.model || '' });
      })
      .catch(() => {
        // Backend offline; card stays with defaults rather than blocking the UI.
      });
  }, []);

  const handleSaveAutocomplete = useCallback(
    async (patch: { enabled?: boolean; useTabby?: boolean }) => {
      if (!acSettings) return;
      setAcStatusMessage('');
      const engine =
        patch.useTabby !== undefined ? (patch.useTabby ? 'tabby' : 'auto') : acSettings.engine;
      try {
        const res = await api.autocompleteSettings.update({
          enabled: patch.enabled,
          engine,
          base_url: acDraft.baseUrl.trim() || undefined,
          model: acDraft.model.trim() || undefined,
        });
        setAcSettings(res);
        setAcDraft({ baseUrl: res.base_url || '', model: res.model || '' });
        setAcStatusMessage(t('settings.autocompleteSaved'));
        // The backend starts a local Tabby server in the background when this
        // save turns the integration on; re-probe so the dot reflects reality.
        setAcProbeState('checking');
        const turningOn = res.enabled && res.engine !== 'cloud' && res.engine !== 'ollama';
        window.setTimeout(
          () => {
            api.autocompleteSettings
              .probe()
              .then((probeRes) => setAcProbeState(probeRes.reachable ? 'up' : 'down'))
              .catch(() => setAcProbeState('down'));
          },
          turningOn ? 3000 : 0
        );
      } catch (err) {
        setAcStatusMessage(err instanceof Error ? err.message : t('settings.autocompleteSaveFailed'));
      }
    },
    [acSettings, acDraft]
  );

  const handleTestTabby = useCallback(async () => {
    setAcStatusMessage('');
    setAcProbeState('checking');
    try {
      // Persist draft values first so the probe targets what the user typed.
      if (
        acSettings &&
        (acDraft.baseUrl.trim() !== (acSettings.base_url || '') ||
          acDraft.model.trim() !== (acSettings.model || ''))
      ) {
        await handleSaveAutocomplete({});
      }
      const res = await api.autocompleteSettings.probe();
      setAcProbeState(res.reachable ? 'up' : 'down');
    } catch {
      setAcProbeState('down');
    }
  }, [acSettings, acDraft, handleSaveAutocomplete]);

  const handleSetupTabby = useCallback(async () => {
    setAcStatusMessage('');
    setIsSettingUpTabby(true);
    setAcProbeState('checking');
    try {
      const res = await api.autocompleteSettings.setup();
      setAcProbeState(res.reachable ? 'up' : 'down');
      setAcStatusMessage(
        res.message || (res.reachable ? t('settings.tabbyReachable') : t('settings.tabbyUnreachable'))
      );
    } catch (err) {
      setAcProbeState('down');
      setAcStatusMessage(err instanceof Error ? err.message : t('settings.autocompleteSetupFailed'));
    } finally {
      setIsSettingUpTabby(false);
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-canvas">
      <ViewHeader icon={<SettingsIcon className="w-5 h-5" />} title={t('settings.title')} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          {/* AI Writing Assistance Configuration */}
          <div className="p-4 rounded border border-border-default bg-surface space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-text-primary">{t('settings.ghostText')}</div>
                <div className="text-text-tertiary">{t('settings.ghostTextDesc')}</div>
              </div>
              <input
                type="checkbox"
                checked={w.enableGhostText}
                onChange={(e) => w.setEnableGhostText(e.target.checked)}
                className="accent-accent w-4 h-4 cursor-pointer"
                aria-label={t('settings.ghostText')}
              />
            </div>

            <div className="border-t border-border-default pt-3 space-y-2">
              <div className="font-medium text-text-primary">{t('settings.latencyTier')}</div>
              <div className="grid grid-cols-3 gap-2">
                {(['fast', 'moderate', 'slow'] as const).map((tier) => (
                  <button
                    key={tier}
                    onClick={() => w.setProviderLatencyTier(tier)}
                    className={`py-1.5 px-2 rounded border text-xs font-medium capitalize transition-colors ${
                      w.providerLatencyTier === tier
                        ? 'border-accent bg-accent/10 text-accent font-semibold'
                        : 'border-border-default bg-sunken hover:bg-surface text-text-secondary'
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-border-default pt-3 space-y-2">
              <div className="font-medium text-text-primary">{t('settings.hourlySuggestionCap')}</div>
              <Select value={String(w.hourlyCap)} onValueChange={(v) => w.setHourlyCap(Number(v))}>
                <SelectTrigger className="w-full h-8 bg-sunken" aria-label={t('settings.hourlySuggestionCap')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">{t('settings.cap50')}</SelectItem>
                  <SelectItem value="100">{t('settings.cap100')}</SelectItem>
                  <SelectItem value="200">{t('settings.cap200')}</SelectItem>
                  <SelectItem value="-1">{t('settings.capUnlimited')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-text-tertiary">
                {t('settings.hourlySuggestionCapDesc')} (Used this hour: {w.hourlyUsage.count})
              </p>
            </div>
          </div>

          {/* AI Autocomplete / Tabby (local) */}
          <div className="p-4 rounded border border-border-default bg-surface space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-text-primary">{t('settings.autocomplete')}</div>
                <div className="text-text-tertiary">{t('settings.autocompleteDesc')}</div>
              </div>
              <input
                type="checkbox"
                checked={acSettings?.enabled ?? false}
                onChange={(e) => handleSaveAutocomplete({ enabled: e.target.checked })}
                disabled={!acSettings}
                className="accent-accent w-4 h-4 cursor-pointer"
                aria-label={t('settings.autocomplete')}
              />
            </div>

            <div className="border-t border-border-default pt-3 flex items-center justify-between">
              <div>
                <div className="font-medium text-text-primary">{t('settings.useTabby')}</div>
                <div className="text-text-tertiary">{t('settings.useTabbyDesc')}</div>
              </div>
              <input
                type="checkbox"
                checked={acSettings?.engine === 'tabby'}
                onChange={(e) => handleSaveAutocomplete({ useTabby: e.target.checked })}
                disabled={!acSettings || !acSettings.enabled}
                className="accent-accent w-4 h-4 cursor-pointer"
                aria-label={t('settings.useTabby')}
              />
            </div>

            <div className="border-t border-border-default pt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={acDraft.baseUrl}
                  onChange={(e) => setAcDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                  placeholder={t('settings.tabbyBaseUrl')}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t('settings.tabbyBaseUrl')}
                  className="w-full px-2.5 py-1.5 rounded border border-border-input bg-sunken text-text-primary font-mono"
                />
                <input
                  type="text"
                  value={acDraft.model}
                  onChange={(e) => setAcDraft((d) => ({ ...d, model: e.target.value }))}
                  placeholder={t('settings.tabbyModel')}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t('settings.tabbyModel')}
                  className="w-full px-2.5 py-1.5 rounded border border-border-input bg-sunken text-text-primary font-mono"
                />
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleSaveAutocomplete({})}
                  disabled={!acSettings}
                  className="px-3 py-1.5 rounded bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-accent-solid-fg font-semibold transition-colors"
                >
                  {t('settings.saveAutocomplete')}
                </button>
                <button
                  onClick={handleTestTabby}
                  disabled={!acSettings || isSettingUpTabby}
                  className="px-3 py-1.5 rounded border border-border-default bg-sunken hover:bg-surface disabled:opacity-40 text-text-primary font-medium transition-colors"
                >
                  {acProbeState === 'checking' ? t('settings.testingConnection') : t('settings.testConnection')}
                </button>
                {acProbeState !== 'up' && (
                  <button
                    onClick={handleSetupTabby}
                    disabled={!acSettings || isSettingUpTabby}
                    title={t('settings.setupTabbyHint')}
                    className="px-3 py-1.5 rounded border border-accent/40 bg-accent/10 hover:bg-accent/20 disabled:opacity-40 text-accent font-medium transition-colors"
                  >
                    {isSettingUpTabby ? t('settings.settingUpTabby') : t('settings.setupTabby')}
                  </button>
                )}
                {acProbeState === 'up' && (
                  <span className="text-trust-success font-semibold" role="status">
                    ● {t('settings.tabbyReachable')}
                  </span>
                )}
                {acProbeState === 'down' && (
                  <span className="text-trust-danger font-semibold" role="status">
                    ● {t('settings.tabbyUnreachable')}
                  </span>
                )}
              </div>

              <p className="text-[11px] text-text-tertiary">{t('settings.engineAutoHint')}</p>
              {acStatusMessage && (
                <p className="text-[11px] text-text-secondary" role="status">
                  {acStatusMessage}
                </p>
              )}
            </div>
          </div>

          {/* AI Provider API Keys (local, no login) */}
          <div className="p-4 rounded border border-border-default bg-surface space-y-3 text-xs">
            <div className="flex items-center justify-between font-medium text-text-primary pb-2 border-b border-border-default">
              <span>AI Model Providers</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent font-semibold">
                Stored locally on this machine
              </span>
            </div>

            <p className="text-text-secondary leading-relaxed">
              OpenResearch runs fully local and needs no account. Add your own API keys to use cloud models;
              Ollama is used automatically as the local fallback.
            </p>

            <div className="rounded border border-border-default bg-sunken p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-text-primary">Cloud rate limit</span>
                {savedRateLimitRpm != null ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-semibold">
                    {savedRateLimitRpm} req/min
                  </span>
                ) : (
                  <span className="text-[11px] text-text-tertiary">Unlimited</span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={rateLimitDraft}
                  onChange={(e) => setRateLimitDraft(e.target.value)}
                  placeholder="Requests per minute (empty = unlimited)"
                  autoComplete="off"
                  aria-label="Cloud rate limit requests per minute"
                  className="w-full px-2.5 py-1.5 rounded border border-border-input bg-surface text-text-primary"
                />
                <button
                  onClick={handleSaveRateLimit}
                  className="shrink-0 px-3 py-1.5 rounded border border-border-default bg-surface hover:bg-sunken text-text-primary font-medium transition-colors"
                >
                  Save Limit
                </button>
              </div>
              <p className="text-[11px] text-text-tertiary">
                Shared cap across all cloud providers. When reached, requests fall back to local Ollama until the
                minute window resets.
              </p>
            </div>

            {aiProviders.map((p) => {
              const draft = providerDrafts[p.provider] || { apiKey: '', model: '', baseUrl: '' };
              const requiresBaseUrl = p.provider === 'custom';
              return (
                <div key={p.provider} className="rounded border border-border-default bg-sunken p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-text-primary">{p.label}</span>
                      {activeAiProvider === p.provider && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-trust-success/15 text-trust-success font-semibold">
                          Active
                        </span>
                      )}
                    </div>
                    <span className={`text-[11px] ${p.configured ? 'text-trust-success' : 'text-text-tertiary'}`}>
                      {p.configured ? `Key saved (${p.masked_key})` : 'Not configured'}
                    </span>
                  </div>

                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(e) => updateProviderDraft(p.provider, 'apiKey', e.target.value)}
                    placeholder={p.configured ? 'Replace API key' : 'Paste API key'}
                    autoComplete="off"
                    aria-label={`${p.label} API key`}
                    className="w-full px-2.5 py-1.5 rounded border border-border-input bg-surface text-text-primary font-mono"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={draft.model}
                      onChange={(e) => updateProviderDraft(p.provider, 'model', e.target.value)}
                      placeholder="Model (e.g. gpt-4o-mini)"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`${p.label} model`}
                      className="w-full px-2.5 py-1.5 rounded border border-border-input bg-surface text-text-primary"
                    />
                    {requiresBaseUrl ? (
                      <input
                        type="text"
                        value={draft.baseUrl}
                        onChange={(e) => updateProviderDraft(p.provider, 'baseUrl', e.target.value)}
                        placeholder="Base URL (e.g. http://localhost:1234/v1)"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`${p.label} base URL`}
                  className="w-full px-2.5 py-1.5 rounded border border-border-input bg-surface text-text-primary"
                      />
                    ) : (
                      <div className="flex items-center px-2.5 text-text-tertiary truncate">{p.base_url}</div>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleSaveProvider(p.provider, requiresBaseUrl)}
                      disabled={!draft.apiKey.trim() && !p.configured}
className="px-3 py-1.5 rounded bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-accent-solid-fg font-semibold transition-colors"
                >
                  Save &amp; Set Active
                    </button>
                    {p.configured && (
                      <button
                        onClick={() => handleClearProvider(p.provider)}
                        className="px-3 py-1.5 rounded border border-border-default bg-surface hover:bg-sunken text-trust-danger font-medium transition-colors"
                      >
                        Remove Key
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {providerStatusMessage && (
              <p className="text-[11px] text-text-secondary" role="status">
                {providerStatusMessage}
              </p>
            )}
          </div>

          {/* Theme & Display Density */}
          <div className="p-4 rounded border border-border-default bg-surface space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-text-primary">{t('settings.theme')}</div>
                <div className="text-text-tertiary">Toggle between Light and Dark palette</div>
              </div>
              <button
                onClick={w.toggleTheme}
                className="px-3 py-1.5 rounded border border-border-default bg-sunken hover:bg-surface font-medium"
              >
                {w.isDark ? t('settings.themeDark') : t('settings.themeLight')}
              </button>
            </div>

            <div className="border-t border-border-default pt-3 flex items-center justify-between">
              <div>
                <div className="font-medium text-text-primary">{t('settings.density')}</div>
                <div className="text-text-tertiary">Comfortable (16px) or Compact (8px for high paper volume)</div>
              </div>
              <button
                onClick={w.toggleDensity}
                className="px-3 py-1.5 rounded border border-border-default bg-sunken hover:bg-surface font-medium"
              >
                {w.densityMode === 'comfortable' ? t('settings.densityComfortable') : t('settings.densityCompact')}
              </button>
            </div>
          </div>

          {/* Plugin System & Extensions (Phase 9.4) */}
          <div className="p-4 rounded border border-border-default bg-surface space-y-3 text-xs">
            <div className="flex items-center justify-between font-medium text-text-primary pb-2 border-b border-border-default">
              <div className="flex items-center space-x-2">
                <Boxes className="w-4 h-4 text-accent" />
                <span>{t('plugins.title')}</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent font-semibold">
                AGPL-3.0
              </span>
            </div>

            <p className="text-text-secondary text-xs leading-relaxed">{t('plugins.subtitle')}</p>

            <button
              onClick={w.openPluginsModal}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-sunken hover:bg-border-default text-text-primary rounded text-xs font-semibold transition-colors"
            >
              <Boxes className="w-3.5 h-3.5 text-accent" />
              <span>Manage Extensions &amp; Plugins</span>
            </button>
          </div>

          <div className="p-4 rounded border border-border-default bg-surface space-y-2 text-xs">
            <div className="font-medium text-text-primary">Version &amp; Governance</div>
            <p className="text-text-secondary">{t('settings.version')}</p>
            <p className="text-text-tertiary font-mono text-[11px]">License: AGPL-3.0-or-later</p>
          </div>
        </div>
      </div>
    </div>
  );
};
