import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from './openai';
import { OllamaProvider } from './ollama';
import { CustomLLMProvider } from './custom';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('LLM Providers (contract & transport)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('OllamaProvider', () => {
    it('posts to /api/chat and parses the message content', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: '  attention is all you need.  ' } })
      );
      vi.stubGlobal('fetch', fetchMock);

      const provider = new OllamaProvider('http://localhost:11434/', 'llama3.2:3b');
      const out = await provider.complete([{ role: 'user', content: 'Summarize' }]);

      expect(out).toBe('attention is all you need.');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/chat');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('llama3.2:3b');
      expect(body.stream).toBe(false);
      expect(body.messages).toHaveLength(1);
    });

    it('checkHealth pings /api/tags and reflects failures honestly', async () => {
      const ok = vi.fn().mockResolvedValue(jsonResponse({ models: [] }));
      vi.stubGlobal('fetch', ok);
      expect(await new OllamaProvider().checkHealth()).toBe(true);

      const down = vi.fn().mockRejectedValue(new Error('connection refused'));
      vi.stubGlobal('fetch', down);
      expect(await new OllamaProvider().checkHealth()).toBe(false);

      const err500 = vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, 500));
      vi.stubGlobal('fetch', err500);
      expect(await new OllamaProvider().checkHealth()).toBe(false);
    });

    it('complete throws on non-200 and on empty completions', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
      await expect(new OllamaProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/status 500/);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: { content: '' } })));
      await expect(new OllamaProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/empty/);
    });

    it('generateAutocomplete returns model text with measured latency and grounding state', async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(async () => jsonResponse({ message: { content: 'empirical gains follow.' } }));
      vi.stubGlobal('fetch', fetchMock);

      const provider = new OllamaProvider();
      const res = await provider.generateAutocomplete({
        prefixText: 'We observe that',
        paragraphContext: 'We observe that',
        mode: 'ghost',
      });

      expect(res.text).toBe('empirical gains follow.');
      expect(res.groundingState).toBe('general-knowledge');
      expect(typeof res.latencyMs).toBe('number');

      const groundedPassages = [
        {
          paperId: 'p1',
          paperTitle: 'Attention Is All You Need',
          authors: 'Vaswani et al.',
          year: 2017,
          passageText: 'Self-attention scales linearly.',
          confidence: 0.9,
        },
      ];
      const grounded = await provider.generateAutocomplete({
        prefixText: 'Prior work shows',
        paragraphContext: '',
        mode: 'continuation',
        groundingPassages: groundedPassages,
      });
      expect(grounded.groundingState).toBe('source-grounded');
      expect(grounded.sourcePassages).toHaveLength(1);

      const sentBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(sentBody.messages[0].role).toBe('system');
      expect(sentBody.messages[1].content).toContain('[1] Attention Is All You Need');
    });

    it('generateAIEdit routes the action instruction through /api/chat', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: { content: 'Improved sentence.' } }));
      vi.stubGlobal('fetch', fetchMock);

      const provider = new OllamaProvider();
      const res = await provider.generateAIEdit({ text: 'kinda good stuff', action: 'academic' });

      expect(res.suggestedText).toBe('Improved sentence.');
      expect(res.action).toBe('academic');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('formal scholarly register');
    });
  });

  describe('OpenAICompatibleProvider', () => {
    it('sends Bearer auth to /chat/completions and parses choices', async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(async () => jsonResponse({ choices: [{ message: { content: 'Grounded completion' } }] }));
      vi.stubGlobal('fetch', fetchMock);

      const provider = new OpenAICompatibleProvider('sk-test', 'https://api.openai.com/v1/', 'gpt-4o-mini');
      const out = await provider.complete([{ role: 'user', content: 'Hello' }]);
      expect(out).toBe('Grounded completion');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer sk-test');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('gpt-4o-mini');
    });

    it('checkHealth hits /models and reports unreachable endpoints', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })));
      expect(await new OpenAICompatibleProvider('k').checkHealth()).toBe(true);

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('dns failure')));
      expect(await new OpenAICompatibleProvider('k').checkHealth()).toBe(false);
    });
  });

  describe('CustomLLMProvider', () => {
    it('sends custom headers and accepts text/content envelopes', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ text: 'custom endpoint says hi' }))
        .mockResolvedValueOnce(jsonResponse({ content: 'via content key' }));
      vi.stubGlobal('fetch', fetchMock);

      const provider = new CustomLLMProvider('https://ai.internal/v1/generate', { Authorization: 'Bearer custom' });
      expect(await provider.complete([{ role: 'user', content: 'Prompt' }])).toBe('custom endpoint says hi');
      expect(await provider.complete([{ role: 'user', content: 'Prompt' }])).toBe('via content key');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://ai.internal/v1/generate');
      expect(init.headers.Authorization).toBe('Bearer custom');
    });

    it('treats any HTTP response as healthy but network errors as unhealthy', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 405 })));
      expect(await new CustomLLMProvider().checkHealth()).toBe(true);

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      expect(await new CustomLLMProvider().checkHealth()).toBe(false);
    });
  });

  describe('all providers share outline scaffolding', () => {
    it('outline honors targetSectionsCount bounds without network calls', async () => {
      for (const provider of [
        new OllamaProvider(),
        new OpenAICompatibleProvider('k'),
        new CustomLLMProvider(),
      ] as const) {
        const res = await provider.generateAIOutline({ topic: 'T', targetSectionsCount: 2 });
        expect(res.sections.length).toBe(3); // clamped to minimum scaffold size
        expect(res.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
