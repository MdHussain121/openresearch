import { describe, it, expectTypeOf } from 'vitest';
import type {
  CitationStyle,
  AttributionScope,
  ExtractionStatus,
  EntryType,
  Author,
  BibliographicReference,
  CitationItem,
  FormattedCitation,
  BibtexParseResult,
} from './types';

describe('Citations Type-Level Assertions', () => {
  it('validates CitationStyle union members', () => {
    expectTypeOf<'apa'>().toMatchTypeOf<CitationStyle>();
    expectTypeOf<'ieee'>().toMatchTypeOf<CitationStyle>();
    expectTypeOf<'chicago-notes'>().toMatchTypeOf<CitationStyle>();
    expectTypeOf<'ama'>().toMatchTypeOf<CitationStyle>();
    expectTypeOf<'oscola'>().toMatchTypeOf<CitationStyle>();
    expectTypeOf<'gbt7714'>().toMatchTypeOf<CitationStyle>();
  });

  it('validates AttributionScope union members', () => {
    expectTypeOf<'sentence'>().toMatchTypeOf<AttributionScope>();
    expectTypeOf<'clause'>().toMatchTypeOf<AttributionScope>();
  });

  it('validates ExtractionStatus union members', () => {
    expectTypeOf<'ok'>().toMatchTypeOf<ExtractionStatus>();
    expectTypeOf<'unverified'>().toMatchTypeOf<ExtractionStatus>();
  });

  it('validates EntryType union members', () => {
    expectTypeOf<'article'>().toMatchTypeOf<EntryType>();
    expectTypeOf<'inproceedings'>().toMatchTypeOf<EntryType>();
    expectTypeOf<'phdthesis'>().toMatchTypeOf<EntryType>();
  });

  it('validates BibliographicReference interface structure', () => {
    expectTypeOf<BibliographicReference>().toHaveProperty('id');
    expectTypeOf<BibliographicReference>().toHaveProperty('title');
    expectTypeOf<BibliographicReference>().toHaveProperty('authors');
    expectTypeOf<BibliographicReference['authors']>().toEqualTypeOf<Author[]>();
    expectTypeOf<BibliographicReference['extractionStatus']>().toEqualTypeOf<ExtractionStatus>();
  });

  it('validates CitationItem interface structure', () => {
    expectTypeOf<CitationItem>().toHaveProperty('id');
    expectTypeOf<CitationItem>().toHaveProperty('documentId');
    expectTypeOf<CitationItem>().toHaveProperty('paperId');
    expectTypeOf<CitationItem['citationStyle']>().toEqualTypeOf<CitationStyle>();
    expectTypeOf<CitationItem['attributionScope']>().toEqualTypeOf<AttributionScope>();
  });

  it('validates FormattedCitation interface structure', () => {
    expectTypeOf<FormattedCitation>().toHaveProperty('inlineMarker');
    expectTypeOf<FormattedCitation>().toHaveProperty('bibliographyEntry');
    expectTypeOf<FormattedCitation>().toHaveProperty('reference');
  });

  it('validates BibtexParseResult interface structure', () => {
    expectTypeOf<BibtexParseResult['entries']>().toEqualTypeOf<BibliographicReference[]>();
    expectTypeOf<BibtexParseResult['errors']>().toEqualTypeOf<string[]>();
    expectTypeOf<BibtexParseResult['totalParsed']>().toEqualTypeOf<number>();
  });
});
