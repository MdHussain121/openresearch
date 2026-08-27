import { describe, it, expect } from 'vitest';
import { OpenAlexProvider } from './openalex';
import { ArxivProvider } from './arxiv';
import { CrossrefProvider } from './crossref';
import { SemanticScholarProvider } from './semantic_scholar';

describe('Research Providers', () => {
  it('instantiates OpenAlexProvider and returns valid quota and empty search results', async () => {
    const provider = new OpenAlexProvider();
    expect(provider.id).toBe('openalex');
    expect(provider.name).toBe('OpenAlex');
    expect(provider.isAvailable).toBe(true);

    const searchRes = await provider.search('quantum computing');
    expect(searchRes.providerName).toBe('OpenAlex');
    expect(searchRes.totalResults).toBe(0);
    expect(searchRes.results).toEqual([]);

    const quota = await provider.getQuotaStatus();
    expect(quota.status).toBe('healthy');
    expect(quota.tier).toBe('free');

    const doiRes = await provider.lookupByDoi('10.1234/test');
    expect(doiRes).toBeNull();

    const arxivRes = await provider.lookupByArxiv('1706.03762');
    expect(arxivRes).toBeNull();

    const pmidRes = await provider.lookupByPmid('123456');
    expect(pmidRes).toBeNull();
  });

  it('instantiates ArxivProvider with valid metadata', async () => {
    const provider = new ArxivProvider();
    expect(provider.id).toBe('arxiv');
    expect(provider.name).toBe('arXiv');
    const quota = await provider.getQuotaStatus();
    expect(quota.status).toBe('healthy');

    expect(await provider.search('test')).toEqual({ totalResults: 0, results: [], providerName: 'arXiv' });
    expect(await provider.lookupByDoi('10.1234/test')).toBeNull();
    expect(await provider.lookupByArxiv('2103.12345')).toBeNull();
    expect(await provider.lookupByPmid('123456')).toBeNull();
  });

  it('instantiates CrossrefProvider with valid metadata', async () => {
    const provider = new CrossrefProvider();
    expect(provider.id).toBe('crossref');
    expect(provider.name).toBe('Crossref');
    const quota = await provider.getQuotaStatus();
    expect(quota.status).toBe('healthy');

    expect(await provider.search('test')).toEqual({ totalResults: 0, results: [], providerName: 'Crossref' });
    expect(await provider.lookupByDoi('10.1234/test')).toBeNull();
    expect(await provider.lookupByArxiv('2103.12345')).toBeNull();
    expect(await provider.lookupByPmid('123456')).toBeNull();
  });

  it('instantiates SemanticScholarProvider with valid metadata', async () => {
    const provider = new SemanticScholarProvider();
    expect(provider.id).toBe('semantic_scholar');
    expect(provider.name).toBe('Semantic Scholar');
    const quota = await provider.getQuotaStatus();
    expect(quota.status).toBe('healthy');

    expect(await provider.search('test')).toEqual({ totalResults: 0, results: [], providerName: 'Semantic Scholar' });
    expect(await provider.lookupByDoi('10.1234/test')).toBeNull();
    expect(await provider.lookupByArxiv('2103.12345')).toBeNull();
    expect(await provider.lookupByPmid('123456')).toBeNull();
  });
});
