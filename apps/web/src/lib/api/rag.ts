import type { GroundedPassage } from '@openresearch/ai';

export interface ChunkDTO {
  id: string;
  paper_id: string;
  project_id: string;
  page_number: number;
  section: string;
  paragraph: number;
  content: string;
  metadata_json?: Record<string, unknown>;
  created_at: string;
}

export interface RAGSearchResponseDTO {
  query: string;
  total_results: number;
  passages: GroundedPassage[];
}

export const ragApi = {};
