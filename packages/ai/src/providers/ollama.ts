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

interface OllamaChatResponse {
  message?: { content?: string };
}

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (Local)';
  readonly supportsStreaming = true;
  readonly expectedLatencyTier = 'moderate' as const;

  constructor(
    private baseUrl: string = 'http://localhost:11434',
    private model: string = 'llama3.2:3b',
    private timeoutMs: number = 20000
  ) {}

  private root(): string {
    return this.baseUrl.replace(/\/+$/, '');
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.root()}/api/tags`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(messages: LLMMessage[], options?: CompletionOptions): Promise<string> {
    if (!messages.length) throw new Error('OllamaProvider.complete requires at least one message');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.root()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: options?.stream ?? false,
          options: {
            temperature: options?.temperature ?? 0.3,
            ...(options?.maxTokens ? { num_predict: options.maxTokens } : {}),
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Ollama returned status ${res.status}`);
      const data = (await res.json()) as OllamaChatResponse;
      const content = data.message?.content?.trim();
      if (!content) throw new Error('Ollama returned an empty completion');
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  async generateAutocomplete(options: AutocompleteOptions): Promise<AutocompleteResult> {
    const started = performance.now();
    const system =
      options.mode === 'ghost'
        ? 'You are an academic co-writer. Continue the author\'s sentence naturally in at most 20 words. Output ONLY the continuation text.'
        : 'You are an academic co-writer. Continue the draft paragraph in a formal scholarly style for roughly 3 sentences. Output ONLY the continuation text.';
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
      explanation: `Transformed via local model ${this.model}.`,
      groundingState: request.groundingPassages?.length ? 'source-grounded' : 'general-knowledge',
      changesSummary: `Applied ${request.action} transformation using ${this.model}.`,
      latencyMs: measureLatencyMs(started),
    };
  }

  async generateAIOutline(request: AIOutlineRequest): Promise<AIOutlineResponse> {
    const started = performance.now();
    return outlineFromScaffold(request, measureLatencyMs(started));
  }
}
