import { request, streamRequest } from './client';
import type { GroundingState, GroundedPassage } from '@openresearch/ai';

export interface AIChatSegmentDTO {
  text: string;
  grounding_state: GroundingState;
  source_indices: number[];
  attribution_scope: string;
}

export type AIChatSourceDTO = GroundedPassage;

export interface AIChatResponseDTO {
  answer: string;
  mode: 'document' | 'library' | 'project' | 'general';
  grounding_state: GroundingState;
  segments: AIChatSegmentDTO[];
  sources: AIChatSourceDTO[];
  trust_legend: {
    source_grounded_count: number;
    ai_inference_count: number;
    general_knowledge_count: number;
  };
  insufficient_evidence: boolean;
  insufficient_evidence_reason?: string;
}

export interface AIChatStreamMetaDTO {
  mode: AIChatResponseDTO['mode'];
  grounding_state: AIChatResponseDTO['grounding_state'];
  sources: Record<string, unknown>[];
  trust_legend: AIChatResponseDTO['trust_legend'];
}

export interface AIChatStreamDoneDTO {
  insufficient_evidence?: boolean;
  insufficient_evidence_reason?: string;
}

export interface AIChatSendPayload {
  message: string;
  mode: 'document' | 'library' | 'project' | 'general';
  paper_id?: string;
  paper_ids?: string[];
  conversation_history?: Array<{ role: string; content: string }>;
}

export interface AIChatStreamHandlers {
  onMeta?: (meta: AIChatStreamMetaDTO) => void;
  onThinking?: (text: string) => void;
  onContent?: (text: string) => void;
  onError?: (detail: string) => void;
  onDone?: (info: AIChatStreamDoneDTO) => void;
}

export const chatApi = {
  send: (projectId: string, data: AIChatSendPayload) =>
    request<AIChatResponseDTO>(`/projects/${projectId}/chat`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Streams the AI chat response over SSE. Each `data:` frame is a JSON object
   * with a `type` of meta | thinking | content | error | done.
   */
  sendStream: (
    projectId: string,
    data: AIChatSendPayload,
    handlers: AIChatStreamHandlers,
    signal?: AbortSignal
  ): Promise<void> =>
    streamRequest(
      `/projects/${projectId}/chat/stream`,
      data,
      (raw) => {
        if (!raw || raw === '[DONE]') return;
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }
        const text = typeof frame.text === 'string' ? frame.text : '';
        switch (frame.type) {
          case 'meta':
            handlers.onMeta?.({
              mode: frame.mode as AIChatStreamMetaDTO['mode'],
              grounding_state: frame.grounding_state as AIChatStreamMetaDTO['grounding_state'],
              sources: Array.isArray(frame.sources) ? frame.sources : [],
              trust_legend: frame.trust_legend as AIChatStreamMetaDTO['trust_legend'],
            });
            break;
          case 'thinking':
            if (text) handlers.onThinking?.(text);
            break;
          case 'content':
            if (text) handlers.onContent?.(text);
            break;
          case 'error':
            handlers.onError?.(typeof frame.detail === 'string' ? frame.detail : 'Unknown streaming error');
            break;
          case 'done':
            handlers.onDone?.({
              insufficient_evidence:
                typeof frame.insufficient_evidence === 'boolean' ? frame.insufficient_evidence : undefined,
              insufficient_evidence_reason:
                typeof frame.insufficient_evidence_reason === 'string'
                  ? frame.insufficient_evidence_reason
                  : undefined,
            });
            break;
        }
      },
      signal
    ),
};
