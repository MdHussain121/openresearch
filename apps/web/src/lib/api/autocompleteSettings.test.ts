import { afterEach, describe, expect, it, vi } from 'vitest';
import { autocompleteSettingsApi } from './autocompleteSettings';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('autocompleteSettingsApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs the effective autocomplete settings', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ enabled: true, engine: 'auto', base_url: 'http://localhost:8080', model: null }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await autocompleteSettingsApi.get();

    expect(out.engine).toBe('auto');
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/ai/autocomplete-settings');
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
  });

  it('PUTs updated settings with a JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ enabled: false, engine: 'tabby' }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await autocompleteSettingsApi.update({ enabled: false, engine: 'tabby', base_url: 'http://127.0.0.1:9000' });

    expect(out.enabled).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/ai/autocomplete-settings');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      enabled: false,
      engine: 'tabby',
      base_url: 'http://127.0.0.1:9000',
    });
  });

  it('POSTs the health probe', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ reachable: true, base_url: 'http://localhost:8080' }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await autocompleteSettingsApi.probe();

    expect(out.reachable).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('GETs the Tabby setup status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ installed: true, version: 'tabby 0.21', reachable: false }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await autocompleteSettingsApi.setupStatus();

    expect(out.installed).toBe(true);
    expect(out.version).toBe('tabby 0.21');
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/ai/autocomplete-settings/status');
  });

  it('POSTs the one-click setup and surfaces the result message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ installed: true, version: null, reachable: true, message: 'Tabby server started and healthy.' })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await autocompleteSettingsApi.setup();

    expect(out.reachable).toBe(true);
    expect(out.message).toContain('started');
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/ai/autocomplete-settings/setup');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('propagates API errors from the setup endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Setup failed' }), { status: 500 }))
    );
    await expect(autocompleteSettingsApi.setup()).rejects.toThrow('Setup failed');
  });
});
