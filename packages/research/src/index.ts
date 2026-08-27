/**
 * @openresearch/research
 * ResearchProvider abstraction and provider registry
 */

export * from './types';
export * from './cache';
export * from './providers/base';
export * from './providers/openalex';
export * from './providers/crossref';
export * from './providers/arxiv';
export * from './providers/semantic_scholar';

import { ResearchProvider } from './providers/base';
import { OpenAlexProvider } from './providers/openalex';
import { CrossrefProvider } from './providers/crossref';
import { ArxivProvider } from './providers/arxiv';
import { SemanticScholarProvider } from './providers/semantic_scholar';

export class ResearchProviderRegistry {
  private providers: Map<string, ResearchProvider> = new Map();

  constructor() {
    this.register(new OpenAlexProvider());
    this.register(new CrossrefProvider());
    this.register(new ArxivProvider());
    this.register(new SemanticScholarProvider());
  }

  register(provider: ResearchProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): ResearchProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): ResearchProvider[] {
    return Array.from(this.providers.values());
  }
}
