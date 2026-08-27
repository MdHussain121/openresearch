import { request } from './client';
import type { GroundingState, GroundedPassage, AIEditActionType } from '@openresearch/ai';

export interface AICompletionResponseDTO {
  text: string;
  grounding_state: GroundingState;
  source_passages: GroundedPassage[];
  mode: string;
  latency_ms: number;
}

export interface AIEditResponseDTO {
  original_text: string;
  suggested_text: string;
  action: AIEditActionType | string;
  explanation?: string;
  changes_summary?: string;
  grounding_state: GroundingState;
  sources: GroundedPassage[];
  latency_ms: number;
}

export interface AIOutlineSectionDTO {
  id: string;
  title: string;
  level: number;
  description?: string;
  key_points: string[];
  suggested_passages: GroundedPassage[];
}

export interface AIOutlineResponseDTO {
  topic: string;
  research_question?: string;
  sections: AIOutlineSectionDTO[];
  estimated_word_count: number;
  grounding_state: GroundingState;
  sources: GroundedPassage[];
  latency_ms: number;
}

export const aiWritingApi = {
  autocomplete: (
    projectId: string,
    data: {
      prefix_text: string;
      suffix_text?: string;
      paragraph_context?: string;
      section_heading?: string;
      mode?: 'ghost' | 'continuation';
      paper_ids?: string[];
    }
  ) =>
    request<AICompletionResponseDTO>(`/projects/${projectId}/ai/autocomplete`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  edit: (
    projectId: string,
    data: {
      text: string;
      action: AIEditActionType | string;
      target_language?: string;
      paragraph_context?: string;
      surrounding_context?: string;
      paper_ids?: string[];
    }
  ) =>
    request<AIEditResponseDTO>(`/projects/${projectId}/ai/edit`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  outline: (
    projectId: string,
    data: {
      topic: string;
      research_question?: string;
      paper_ids?: string[];
      target_sections_count?: number;
      context_notes?: string;
    }
  ) =>
    request<AIOutlineResponseDTO>(`/projects/${projectId}/ai/outline`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
