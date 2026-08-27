/**
 * Base ResearchProvider interface
 */

import { BibliographicReference } from '@openresearch/citations';
import { QuotaStatus, SearchOptions, SearchResult } from '../types';

export interface ResearchProvider {
  readonly id: string;
  readonly name: string;
  readonly isAvailable: boolean;

  search(query: string, options?: SearchOptions): Promise<SearchResult>;
  lookupByDoi(doi: string): Promise<BibliographicReference | null>;
  lookupByArxiv(arxivId: string): Promise<BibliographicReference | null>;
  lookupByPmid(pmid: string): Promise<BibliographicReference | null>;
  getQuotaStatus(): Promise<QuotaStatus>;
}
