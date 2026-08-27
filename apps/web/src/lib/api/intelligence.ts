import { request } from './client';

export interface ClaimFlagDTO {
  claim_id: string;
  text: string;
  flag_type: string;
  message: string;
  suggested_query: string;
  start_char?: number;
  end_char?: number;
  is_dismissed: boolean;
}

export interface VerifyClaimsResponseDTO {
  total_claims_analyzed: number;
  unsupported_claims_count: number;
  dismissed_claims_count: number;
  claims: ClaimFlagDTO[];
  confidence_scoring_status: string;
}

export interface ResearchGapLimitationDTO {
  paper_id: string;
  paper_title: string;
  authors: string;
  year?: number;
  page_number: number;
  section: string;
  excerpt: string;
  paraphrased_limitation: string;
}

export interface ResearchGapQuoteDTO {
  paper_id: string;
  paper_title: string;
  authors: string;
  year?: number;
  page_number: number;
  section: string;
  excerpt: string;
  paraphrased_opportunity: string;
}

export interface ResearchGapItemDTO {
  id: string;
  title: string;
  category: string;
  description: string;
  raw_evidence_count: number;
  supporting_papers_count: number;
  author_limitations: ResearchGapLimitationDTO[];
  future_work_quotes: ResearchGapQuoteDTO[];
  unsupported_claims: string[];
}

export interface ResearchGapsResponseDTO {
  analyzed_papers_count: number;
  potential_gaps: ResearchGapItemDTO[];
  disclaimer: string;
  confidence_scoring_status: string;
}

export interface MatrixCellDTO {
  value: string;
  paper_id: string;
  paper_title: string;
  page_number?: number;
  section?: string;
  source_excerpt?: string;
}

export interface LiteratureMatrixRowDTO {
  paper_id: string;
  paper_title: string;
  authors: string;
  year?: number;
  doi?: string;
  method: MatrixCellDTO;
  dataset: MatrixCellDTO;
  results: MatrixCellDTO;
  limitations: MatrixCellDTO;
}

export interface LiteratureMatrixResponseDTO {
  headers: string[];
  rows: LiteratureMatrixRowDTO[];
  markdown_table: string;
  total_papers: number;
}

export interface ReviewCategorySummaryDTO {
  category: string;
  score: number;
  total_issues: number;
  warnings: number;
  suggestions: number;
  summary_text: string;
}

export interface ReviewIssueDTO {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  flagged_text?: string;
  suggestion: string;
  suggested_action?: string;
}

export interface PaperReviewResponseDTO {
  document_id?: string;
  document_title: string;
  overall_score: number;
  categories: Record<string, ReviewCategorySummaryDTO>;
  issues: ReviewIssueDTO[];
  analyzed_at: string;
}

export const intelligenceApi = {
  verifyClaims: (
    projectId: string,
    data: { document_id?: string; text?: string; dismissed_claim_ids?: string[] }
  ) =>
    request<VerifyClaimsResponseDTO>(`/projects/${projectId}/intelligence/verify-claims`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  researchGaps: (projectId: string, data: { paper_ids?: string[]; focus_topic?: string }) =>
    request<ResearchGapsResponseDTO>(`/projects/${projectId}/intelligence/research-gaps`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  literatureMatrix: (projectId: string, data: { paper_ids?: string[] }) =>
    request<LiteratureMatrixResponseDTO>(`/projects/${projectId}/intelligence/literature-matrix`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  paperReview: (projectId: string, data: { document_id?: string; text?: string; title?: string }) =>
    request<PaperReviewResponseDTO>(`/projects/${projectId}/intelligence/paper-review`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
