import { request } from './client';
import type { Author } from '@openresearch/citations';

export interface LiteratureResultDTO {
  title: string;
  authors: Author[];
  year?: number;
  abstract?: string;
  doi?: string;
  arxiv_id?: string;
  pmid?: string;
  venue?: string;
  url?: string;
  pdf_url?: string;
  open_access: boolean;
  citation_count?: number;
  source: string;
}

export interface LiteratureSourceDTO {
  source: string;
  status: 'ok' | 'error';
  error?: string;
  total?: number;
  results: LiteratureResultDTO[];
}

export interface LiteratureSearchDTO {
  query: string;
  sources: LiteratureSourceDTO[];
}

export interface LiteratureSearchParams {
  q: string;
  sources?: string[];
  yearStart?: number;
  yearEnd?: number;
  openAccessOnly?: boolean;
  limit?: number;
  offset?: number;
}

export const researchApi = {
  search: ({
    q,
    sources,
    yearStart,
    yearEnd,
    openAccessOnly,
    limit = 10,
    offset = 0,
  }: LiteratureSearchParams) => {
    const params = new URLSearchParams({ q });
    if (sources && sources.length > 0) params.set('sources', sources.join(','));
    if (yearStart) params.set('year_start', String(yearStart));
    if (yearEnd) params.set('year_end', String(yearEnd));
    if (openAccessOnly) params.set('open_access_only', 'true');
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return request<LiteratureSearchDTO>(`/research/search?${params.toString()}`);
  },
};
