/**
 * Base LLMProvider interface
 */

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

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly supportsStreaming: boolean;
  readonly expectedLatencyTier: 'fast' | 'moderate' | 'slow'; // Fast < 300ms (Ghost text eligible)

  complete(messages: LLMMessage[], options?: CompletionOptions): Promise<string>;
  generateAutocomplete(options: AutocompleteOptions): Promise<AutocompleteResult>;
  generateAIEdit(request: AIEditRequest): Promise<AIEditResponse>;
  generateAIOutline(request: AIOutlineRequest): Promise<AIOutlineResponse>;
  checkHealth(): Promise<boolean>;
}

