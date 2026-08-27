import {
  AutocompleteOptions,
  AutocompleteResult,
  CompletionOptions,
  LLMMessage,
  AIEditRequest,
  AIEditResponse,
  AIOutlineRequest,
  AIOutlineResponse,
} from '../types';
import { LLMProvider } from './base';
import {
  EDIT_ACTION_INSTRUCTIONS,
  buildGroundingBlock,
  measureLatencyMs,
  outlineFromScaffold,
} from './shared';

/**
 * Talks to an arbitrary HTTP endpoint that accepts
 * POST {messages, options} and returns {"text": "..."} (or {"content": "..."}).
 */
export class CustomLLMProvider implements LLMProvider {
  readonly id = 'custom';
  readonly name = 'Custom LLM Endpoint';
  readonly supportsStreaming = true;
  readonly expectedLatencyTier = 'slow' as const;

  constructor(
    private endpointUrl: string = 'http://localhost:8000/v1/generate',
    private customHeaders: Record<string, string> = {},
    private timeoutMs: number = 30000
  ) {}

  async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        // Any HTTP response (even 405/404) proves the endpoint is reachable.
        const res = await fetch(this.endpointUrl, { method: 'GET', signal: controller.signal });
        return true;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  async complete(messages: LLMMessage[], options?: CompletionOptions): Promise<string> {
    if (!messages.length) throw new Error('CustomLLMProvider.complete requires at least one message');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.customHeaders },
        body: JSON.stringify({
          messages,
          options: {
            temperature: options?.temperature ?? 0.3,
            ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Custom endpoint returned status ${res.status}`);
      const data = (await res.json()) as { text?: string; content?: string };
      const content = (data.text ?? data.content ?? '').trim();
      if (!content) throw new Error('Custom endpoint returned an empty completion');
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  async generateAutocomplete(options: AutocompleteOptions): Promise<AutocompleteResult> {
    const started = performance.now();
    const system =
      options.mode === 'ghost'
        ? 'Continue the author\'s academic sentence naturally in at most 20 words. Output ONLY the continuation.'
        : 'Continue the draft paragraph in a formal scholarly style for roughly 3 sentences. Output ONLY the continuation.';
    const user = `${options.sectionHeading ? `Section: ${options.sectionHeading}\n` : ''}${
      options.paragraphContext ? `Paragraph so far: ${options.paragraphContext}\n` : ''
    }Current text: ${options.prefixText}${buildGroundingBlock(options.groundingPassages)}`;

    const text = await this.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.2 }
    );

    return {
      text,
      groundingState: options.groundingPassages?.length ? 'source-grounded' : 'general-knowledge',
      sourcePassages: options.groundingPassages ?? [],
      latencyMs: measureLatencyMs(started),
    };
  }

  async generateAIEdit(request: AIEditRequest): Promise<AIEditResponse> {
    const started = performance.now();
    const instruction =
      EDIT_ACTION_INSTRUCTIONS[request.action] ?? 'Improve the passage while preserving its meaning.';
    const suggestedText = await this.complete(
      [
        {
          role: 'system',
          content: `You are an academic writing editor. ${instruction} Return ONLY the transformed text.`,
        },
        { role: 'user', content: request.text },
      ],
      { temperature: 0.2 }
    );

    return {
      originalText: request.text,
      suggestedText,
      action: request.action,
      explanation: `Transformed via custom endpoint.`,
      groundingState: request.groundingPassages?.length ? 'source-grounded' : 'general-knowledge',
      changesSummary: `Applied ${request.action} transformation via custom API.`,
      latencyMs: measureLatencyMs(started),
    };
  }

  async generateAIOutline(request: AIOutlineRequest): Promise<AIOutlineResponse> {
    const started = performance.now();
    return outlineFromScaffold(request, measureLatencyMs(started));
  }
}
