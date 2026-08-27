import { BibliographicReference } from '@openresearch/citations';
import { QuotaStatus, SearchOptions, SearchResult } from '../types';
import { ResearchProvider } from './base';

export class CrossrefProvider implements ResearchProvider {
  readonly id = 'crossref';
  readonly name = 'Crossref';
  readonly isAvailable = true;

  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    return {
      totalResults: 0,
      results: [],
      providerName: this.name,
    };
  }

  async lookupByDoi(doi: string): Promise<BibliographicReference | null> {
    return null;
  }

  async lookupByArxiv(arxivId: string): Promise<BibliographicReference | null> {
    return null;
  }

  async lookupByPmid(pmid: string): Promise<BibliographicReference | null> {
    return null;
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    return {
      providerName: this.name,
      isUsageBased: false,
      tier: 'free',
      status: 'healthy',
    };
  }
}
