import { request } from './client';
import type { Author, CitationItem, CitationStyle, AttributionScope, ExtractionStatus } from '@openresearch/citations';
import type { PaperDTO } from './papers';

export interface CitationDTO {
  id: string;
  document_id: string;
  paper_id: string;
  position: number;
  citation_style: CitationStyle | string;
  attribution_scope: AttributionScope | string;
  page_number?: number;
  relevant_passage?: string;
  created_at: string;
  paper?: PaperDTO;
}

export interface ResolvedIdentifierDTO {
  identifier: string;
  id_type: string;
  title?: string;
  authors: Author[];
  year?: number;
  abstract?: string;
  doi?: string;
  arxiv_id?: string;
  pmid?: string;
  journal?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  bibtex?: string;
  extraction_status: ExtractionStatus;
}

export interface RankedCitationDTO {
  paper_id: string;
  title: string;
  authors: Author[];
  year?: number;
  score: number;
  extraction_status: ExtractionStatus;
}

export const citationsApi = {
  list: (documentId: string) => request<CitationDTO[]>(`/documents/${documentId}/citations`),
  create: (
    documentId: string,
    data: {
      paper_id: string;
      position?: number;
      citation_style?: CitationStyle | string;
      attribution_scope?: AttributionScope | string;
      page_number?: number;
      relevant_passage?: string;
    }
  ) =>
    request<CitationDTO>(`/documents/${documentId}/citations`, {
      method: 'POST',
      body: JSON.stringify({ document_id: documentId, ...data }),
    }),
  delete: (documentId: string, citationId: string) =>
    request<void>(`/documents/${documentId}/citations/${citationId}`, {
      method: 'DELETE',
    }),
  resolveIdentifier: (identifier: string, idType: string = 'auto') =>
    request<ResolvedIdentifierDTO>('/citations/resolve-identifier', {
      method: 'POST',
      body: JSON.stringify({ identifier, id_type: idType }),
    }),
  addByIdentifier: (projectId: string, identifier: string, idType: string = 'auto') =>
    request<PaperDTO>(`/projects/${projectId}/papers/add-by-identifier`, {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, identifier, id_type: idType }),
    }),
  importBibtex: (projectId: string, bibtexContent: string) =>
    request<{ total_imported: number; papers: PaperDTO[] }>(`/projects/${projectId}/papers/import-bibtex`, {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, bibtex_content: bibtexContent }),
    }),
  exportProjectBibtex: (projectId: string) =>
    request<{ bibtex_content: string; total_entries: number }>(`/projects/${projectId}/export/bibtex`),
  exportDocumentBibtex: (documentId: string) =>
    request<{ bibtex_content: string; total_entries: number }>(`/documents/${documentId}/export/bibtex`),
};
