import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, streamRequest } from './client';

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('streamRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('parses data frames across chunk boundaries and buffers partial events', async () => {
    const frames: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"chunk":"Hel',
          'lo"}\n\ndata: {"chunk":" wor',
          'ld","done":false}\n\ndata: {"chunk":"","done":true}\n\n',
        ])
      )
    );

    await streamRequest('/projects/p1/ai/stream-autocomplete', { prefix_text: 'Hi' }, (f) => frames.push(f));

    expect(frames).toEqual(['{"chunk":"Hello"}', '{"chunk":" world","done":false}', '{"chunk":"","done":true}']);
  });

  it('emits a trailing frame without a final blank line', async () => {
    const frames: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(['data: {"chunk":"tail"}'])));
    await streamRequest('/x', {}, (f) => frames.push(f));
    expect(frames).toEqual(['{"chunk":"tail"}']);
  });

  it('throws the API error detail on non-OK responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Project not found' }), { status: 404 }))
    );
    await expect(streamRequest('/x', {}, () => {})).rejects.toThrow('Project not found');
  });
});

describe('request', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed JSON without attaching auth headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await request<{ id: string }>('/projects/p1');

    expect(out.id).toBe('p1');
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/projects/p1');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  it('maps 204 responses to an empty object without parsing JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(request('/x', { method: 'DELETE' })).resolves.toEqual({});
  });

  it('extracts the API error detail from error envelopes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Permission denied' }), { status: 403 }))
    );
    await expect(request('/x')).rejects.toThrow('Permission denied');
  });
});
