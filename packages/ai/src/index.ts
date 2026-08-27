/**
 * @openresearch/ai
 * LLMProvider abstraction and AI provider registry
 */

export * from './types';
export * from './providers/base';
export * from './providers/openai';
export * from './providers/ollama';
export * from './providers/custom';

import { LLMProvider } from './providers/base';
import { OpenAICompatibleProvider } from './providers/openai';
import { OllamaProvider } from './providers/ollama';
import { CustomLLMProvider } from './providers/custom';

export class LLMProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();

  constructor() {
    this.register(new OpenAICompatibleProvider());
    this.register(new OllamaProvider());
    this.register(new CustomLLMProvider());
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): LLMProvider[] {
    return Array.from(this.providers.values());
  }
}
