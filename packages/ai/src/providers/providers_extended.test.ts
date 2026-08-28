import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from './openai';
import { CustomLLMProvider } from './custom';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AI Providers Extended Test Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('CustomLLMProvider extended behaviors', () => {
    it('throws error when complete is called with empty messages', async () => {
      const provider = new CustomLLMProvider();
      await expect(provider.complete([])).rejects.toThrow('requires at least one message');
    });

    it('throws error on non-ok HTTP status code', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'fail' }, 502)));
      const provider = new CustomLLMProvider();
      await expect(provider.complete([{ role: 'user', content: 'test' }])).rejects.toThrow(
        'Custom endpoint returned status 502'
      );
    });

    it('throws error when custom endpoint returns empty text and content', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ text: '   ' })));
      const provider = new CustomLLMProvider();
      await expect(provider.complete([{ role: 'user', content: 'test' }])).rejects.toThrow(
        'returned an empty completion'
      );
    });

    it('generateAutocomplete runs in ghost mode without grounding passages', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: 'is a key contribution.' }));
      vi.stubGlobal('fetch', fetchMock);

      const provider = new CustomLLMProvider('https://custom.ai/gen', { 'X-Key': '123' });
      const result = await provider.generateAutocomplete({
        prefixText: 'This architecture',
        paragraphContext: '',
        mode: 'ghost',
      });

      expect(result.text).toBe('is a key contribution.');
      expect(result.groundingState).toBe('general-knowledge');
      expect(result.sourcePassages).toEqual([]);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(reqBody.messages[0].content).toContain('academic sentence');
      expect(reqBody.options.temperature).toBe(0.2);
    });

    it('generateAutocomplete runs in continuation mode with section and grounding passages', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ content: 'Furthermore, the results hold.' }));
      vi.stubGlobal('fetch', fetchMock);

      const provider = new CustomLLMProvider();
      const passages = [
        {
          paperId: 'p123',
          paperTitle: 'Deep Learning',
          authors: 'LeCun et al.',
          year: 2015,
          passageText: 'Backprop trains multi-layer architectures.',
          confidence: 1.0,
        },
      ];

      const result = await provider.generateAutocomplete({
        prefixText: 'We build upon prior work.',
        paragraphContext: 'Recent advances show that neural nets perform well.',
        sectionHeading: '3. Methodology',
        mode: 'continuation',
        groundingPassages: passages,
      });

      expect(result.text).toBe('Furthermore, the results hold.');
      expect(result.groundingState).toBe('source-grounded');
      expect(result.sourcePassages).toHaveLength(1);

      const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(reqBody.messages[1].content).toContain('Section: 3. Methodology');
      expect(reqBody.messages[1].content).toContain('Paragraph so far:');
      expect(reqBody.messages[1].content).toContain('[1] Deep Learning');
    });

    it('generateAIEdit applies edit actions and returns formatted response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: 'In accordance with our results...' }));
      vi.stubGlobal('fetch', fetchMock);

      const provider = new CustomLLMProvider();
      const res = await provider.generateAIEdit({
        text: 'So basically what we found was',
        action: 'academic',
        groundingPassages: [
          {
            paperId: 'p1',
            paperTitle: 'Paper 1',
            authors: 'Smith',
            year: 2020,
            passageText: 'Data shows...',
            confidence: 1.0,
          },
        ],
      });

      expect(res.originalText).toBe('So basically what we found was');
      expect(res.suggestedText).toBe('In accordance with our results...');
      expect(res.action).toBe('academic');
      expect(res.groundingState).toBe('source-grounded');
      expect(res.explanation).toContain('custom endpoint');
    });
  });

  describe('OpenAICompatibleProvider extended behaviors', () => {
    it('throws error when complete is called with empty messages', async () => {
      const provider = new OpenAICompatibleProvider('sk-key');
      await expect(provider.complete([])).rejects.toThrow('requires at least one message');
    });

    it('throws error on non-ok HTTP status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)));
      const provider = new OpenAICompatibleProvider('sk-key');
      await expect(provider.complete([{ role: 'user', content: 'test' }])).rejects.toThrow(
        /status 401/
      );
    });

    it('throws error when response choices are empty or content is missing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ choices: [] })));
      const provider = new OpenAICompatibleProvider('sk-key');
      await expect(provider.complete([{ role: 'user', content: 'test' }])).rejects.toThrow(
        'returned an empty completion'
      );
    });

    it('generateAutocomplete works in ghost and continuation modes', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: 'yields substantial improvements.' } }],
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      const provider = new OpenAICompatibleProvider('sk-test', 'https://api.openai.com/v1', 'gpt-4o');
      const res = await provider.generateAutocomplete({
        prefixText: 'This optimization',
        paragraphContext: '',
        mode: 'ghost',
        sectionHeading: 'Introduction',
      });

      expect(res.text).toBe('yields substantial improvements.');
      expect(res.groundingState).toBe('general-knowledge');
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);

      const reqBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(reqBody.model).toBe('gpt-4o');
      expect(reqBody.messages[1].content).toContain('Section: Introduction');
    });

    it('generateAIEdit applies edit actions properly', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: 'The findings demonstrate...' } }],
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      const provider = new OpenAICompatibleProvider('sk-test');
      const res = await provider.generateAIEdit({
        text: 'The findings show that...',
        action: 'clarity',
      });

      expect(res.suggestedText).toBe('The findings demonstrate...');
      expect(res.action).toBe('clarity');
      expect(res.groundingState).toBe('general-knowledge');
      expect(res.explanation).toContain('gpt-4o-mini');
    });
  });
});
