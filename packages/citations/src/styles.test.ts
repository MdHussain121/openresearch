import { describe, it, expect } from 'vitest';
import {
  formatInlineAuthors,
  formatInlineCitation,
  formatBibliographyEntry,
  generateBibliography,
  parseZoteroJson,
} from './styles';
import { Author, BibliographicReference, CitationStyle } from './types';

describe('Citation Styles Module', () => {
  const author1: Author = { familyName: 'Vaswani', givenName: 'Ashish' };
  const author2: Author = { familyName: 'Shazeer', givenName: 'Noam' };
  const author3: Author = { familyName: 'Parmar', givenName: 'Niki' };

  const samplePaper: BibliographicReference = {
    id: 'paper-1',
    title: 'Attention Is All You Need',
    authors: [author1, author2, author3],
    year: 2017,
    journal: 'Advances in Neural Information Processing Systems',
    volume: '30',
    pages: '5998-6008',
    doi: '10.5555/3295222.3295349',
    extractionStatus: 'ok',
  };

  describe('formatInlineAuthors', () => {
    it('handles empty author array', () => {
      expect(formatInlineAuthors([], 'apa')).toBe('Unknown');
    });

    it('formats single author correctly', () => {
      expect(formatInlineAuthors([author1], 'apa')).toBe('Vaswani');
      expect(formatInlineAuthors([author1], 'mla')).toBe('Vaswani');
    });

    it('formats two authors with ampersand in APA and Harvard, "and" in MLA and Chicago', () => {
      expect(formatInlineAuthors([author1, author2], 'apa')).toBe('Vaswani & Shazeer');
      expect(formatInlineAuthors([author1, author2], 'harvard')).toBe('Vaswani & Shazeer');
      expect(formatInlineAuthors([author1, author2], 'mla')).toBe('Vaswani and Shazeer');
      expect(formatInlineAuthors([author1, author2], 'chicago')).toBe('Vaswani and Shazeer');
    });

    it('formats three or more authors with "et al."', () => {
      expect(formatInlineAuthors([author1, author2, author3], 'apa')).toBe('Vaswani et al.');
      expect(formatInlineAuthors([author1, author2, author3], 'ieee')).toBe('Vaswani et al.');
    });
  });

  describe('formatInlineCitation', () => {
    it('formats APA inline citation with year and optional page', () => {
      expect(formatInlineCitation(samplePaper, 'apa', 1)).toBe('(Vaswani et al., 2017)');
      expect(formatInlineCitation(samplePaper, 'apa', 1, 42)).toBe('(Vaswani et al., 2017: 42)');
    });

    it('formats MLA inline citation without comma, with optional page', () => {
      expect(formatInlineCitation(samplePaper, 'mla', 1)).toBe('(Vaswani et al.)');
      expect(formatInlineCitation(samplePaper, 'mla', 1, 42)).toBe('(Vaswani et al. 42)');
    });

    it('formats IEEE and ACM as numeric brackets [index]', () => {
      expect(formatInlineCitation(samplePaper, 'ieee', 1)).toBe('[1]');
      expect(formatInlineCitation(samplePaper, 'acm', 2)).toBe('[2]');
    });

    it('formats Vancouver and Science as parenthesized numbers (index)', () => {
      expect(formatInlineCitation(samplePaper, 'vancouver', 3)).toBe('(3)');
      expect(formatInlineCitation(samplePaper, 'science', 4)).toBe('(4)');
    });

    it('formats Nature and Chicago-Notes as plain superscript integers', () => {
      expect(formatInlineCitation(samplePaper, 'nature', 5)).toBe('5');
      expect(formatInlineCitation(samplePaper, 'chicago-notes', 6)).toBe('6');
    });

    it('formats Chicago and Harvard author-date citations', () => {
      expect(formatInlineCitation(samplePaper, 'chicago', 1)).toBe('(Vaswani et al. 2017)');
      expect(formatInlineCitation(samplePaper, 'harvard', 1)).toBe('(Vaswani et al., 2017)');
    });

    it('handles papers with missing year gracefully ("n.d.")', () => {
      const paperNoYear: BibliographicReference = {
        id: 'no-year',
        title: 'Draft Paper',
        authors: [author1],
        extractionStatus: 'ok',
      };
      expect(formatInlineCitation(paperNoYear, 'apa', 1)).toBe('(Vaswani, n.d.)');
    });
  });

  describe('formatBibliographyEntry', () => {
    it('formats APA 7th edition bibliography entry', () => {
      const entry = formatBibliographyEntry(samplePaper, 'apa', 1);
      expect(entry).toContain('Vaswani, A.');
      expect(entry).toContain('(2017)');
      expect(entry).toContain('Attention Is All You Need.');
      expect(entry).toContain('Advances in Neural Information Processing Systems');
      expect(entry).toContain('https://doi.org/10.5555/3295222.3295349');
    });

    it('formats MLA 9th edition bibliography entry', () => {
      const entry = formatBibliographyEntry(samplePaper, 'mla', 1);
      expect(entry).toContain('Vaswani, A., et al.');
      expect(entry).toContain('"Attention Is All You Need."');
      expect(entry).toContain('2017');
    });

    it('formats IEEE numbered bibliography entry', () => {
      const entry = formatBibliographyEntry(samplePaper, 'ieee', 1);
      expect(entry).toContain('[1]');
      expect(entry).toContain('Attention Is All You Need');
      expect(entry).toContain('Advances in Neural Information Processing Systems');
    });

    it('formats Vancouver style bibliography entry', () => {
      const entry = formatBibliographyEntry(samplePaper, 'vancouver', 1);
      expect(entry).toContain('(1)');
      expect(entry).toContain('Attention Is All You Need.');
    });

    it('formats Nature style bibliography entry', () => {
      const entry = formatBibliographyEntry(samplePaper, 'nature', 1);
      expect(entry).toContain('1.');
      expect(entry).toContain('Attention Is All You Need.');
      expect(entry).toContain('(2017)');
    });

    it('formats Chicago author-date bibliography entry with 2 and 3 authors', () => {
      const p2: BibliographicReference = {
        id: 'p2',
        title: 'Two Authors',
        authors: [author1, author2],
        year: 2018,
        extractionStatus: 'ok',
      };
      const p3: BibliographicReference = {
        id: 'p3',
        title: 'Three Authors',
        authors: [author1, author2, author3],
        year: 2019,
        extractionStatus: 'ok',
      };
      expect(formatBibliographyEntry(p2, 'chicago', 1)).toContain('Vaswani, A., and Noam Shazeer');
      expect(formatBibliographyEntry(p3, 'chicago', 1)).toContain('Vaswani, A., Noam Shazeer, and Niki Parmar');
    });

    it('formats Vancouver and IEEE with >6 authors', () => {
      const eightAuthors: Author[] = Array.from({ length: 8 }, (_, i) => ({
        familyName: `Author${i + 1}`,
        givenName: `First${i + 1}`,
      }));
      const p8: BibliographicReference = {
        id: 'p8',
        title: 'Eight Authors',
        authors: eightAuthors,
        year: 2020,
        extractionStatus: 'ok',
      };
      expect(formatBibliographyEntry(p8, 'vancouver', 1)).toContain('et al.');
      expect(formatBibliographyEntry(p8, 'ieee', 1)).toContain('F. Author1 et al.');
    });

    it('formats MLA and Harvard with 2 authors', () => {
      const p2: BibliographicReference = {
        id: 'p2',
        title: 'Two Authors',
        authors: [author1, author2],
        year: 2018,
        extractionStatus: 'ok',
      };
      expect(formatBibliographyEntry(p2, 'mla', 1)).toContain('Vaswani, A., and Noam Shazeer');
      expect(formatBibliographyEntry(p2, 'harvard', 1)).toContain('Vaswani, A. and Shazeer, N.');
    });

    it('handles author with only literal or missing givenName', () => {
      const pLit: BibliographicReference = {
        id: 'p-lit',
        title: 'Institutional Report',
        authors: [{ literal: 'World Health Organization', familyName: 'WHO' }],
        year: 2022,
        extractionStatus: 'ok',
      };
      expect(formatBibliographyEntry(pLit, 'apa', 1)).toContain('World Health Organization');
    });

    it('formats Harvard, Science, ACM, ACS, Chicago-Notes, and Turabian bibliography entries', () => {
      expect(formatBibliographyEntry(samplePaper, 'harvard', 1)).toContain("'Attention Is All You Need'");
      expect(formatBibliographyEntry(samplePaper, 'science', 1)).toContain('(1)');
      expect(formatBibliographyEntry(samplePaper, 'acm', 1)).toContain('[1]');
      expect(formatBibliographyEntry(samplePaper, 'acs', 1)).toContain('(1)');
      expect(formatBibliographyEntry(samplePaper, 'chicago-notes', 1)).toContain('1.');
      expect(formatBibliographyEntry(samplePaper, 'turabian', 1)).toContain('"Attention Is All You Need."');
    });

    it('formats AMA, NLM, and CSE biomedical/science bibliography entries', () => {
      expect(formatBibliographyEntry(samplePaper, 'ama', 1)).toContain('[1]');
      expect(formatBibliographyEntry(samplePaper, 'ama', 1)).toContain('doi:');
      expect(formatBibliographyEntry(samplePaper, 'nlm', 1)).toContain('(1)');
      expect(formatBibliographyEntry(samplePaper, 'cse', 1)).toContain('[1]');
    });

    it('formats APSA, ASA, and AAA social-science bibliography entries', () => {
      const apsa = formatBibliographyEntry(samplePaper, 'apsa', 1);
      expect(apsa).toContain('"Attention Is All You Need."');
      expect(formatBibliographyEntry(samplePaper, 'asa', 1)).toMatch(/2017\. "Attention Is All You Need\."/);
      expect(formatBibliographyEntry(samplePaper, 'aaa', 1)).toContain('"Attention Is All You Need."');
    });

    it('formats MHRA, Oxford, OSCOLA, and Bluebook humanities/legal bibliography entries', () => {
      expect(formatBibliographyEntry(samplePaper, 'mhra', 1)).toContain("'Attention Is All You Need'");
      expect(formatBibliographyEntry(samplePaper, 'oxford', 1)).toContain('(2017)');
      expect(formatBibliographyEntry(samplePaper, 'oscola', 1)).toContain('(2017) 30');
      expect(formatBibliographyEntry(samplePaper, 'bluebook', 1)).toContain('(2017)');
    });

    it('formats ABNT, ISO690, GB/T 7714, and Cell international/press bibliography entries', () => {
      expect(formatBibliographyEntry(samplePaper, 'abnt', 1)).toContain('v. 30');
      expect(formatBibliographyEntry(samplePaper, 'abnt', 1)).toContain('VASWANI');
      expect(formatBibliographyEntry(samplePaper, 'iso690', 1)).toContain('pp. 5998-6008');
      expect(formatBibliographyEntry(samplePaper, 'gbt7714', 1)).toContain('[J]');
      expect(formatBibliographyEntry(samplePaper, 'cell', 1)).toContain('(2017)');
    });

    it('formats inline markers for all newly added styles', () => {
      expect(formatInlineCitation(samplePaper, 'ama', 4)).toBe('4');
      expect(formatInlineCitation(samplePaper, 'nlm', 2)).toBe('(2)');
      expect(formatInlineCitation(samplePaper, 'cse', 3)).toBe('[3]');
      expect(formatInlineCitation(samplePaper, 'apsa', 1)).toBe('(Vaswani et al., 2017)');
      expect(formatInlineCitation(samplePaper, 'asa', 1)).toBe('(Vaswani et al. 2017)');
      expect(formatInlineCitation(samplePaper, 'mhra', 7)).toBe('7');
      expect(formatInlineCitation(samplePaper, 'oxford', 7)).toBe('7');
      expect(formatInlineCitation(samplePaper, 'oscola', 7)).toBe('7');
      expect(formatInlineCitation(samplePaper, 'bluebook', 7)).toBe('7');
      expect(formatInlineCitation(samplePaper, 'iso690', 1)).toBe('(Vaswani et al., 2017)');
      expect(formatInlineCitation(samplePaper, 'gbt7714', 9)).toBe('[9]');
      expect(formatInlineCitation(samplePaper, 'cell', 8)).toBe('(8)');
      expect(formatInlineCitation(samplePaper, 'abnt', 1)).toBe('(VASWANI et al., 2017)');
    });

    it('formats ABNT inline citations with two authors using semicolon join', () => {
      const twoAuthors: BibliographicReference = {
        id: 'two-abnt',
        title: 'Pair Study',
        authors: [author1, author2],
        year: 2017,
        extractionStatus: 'ok',
      };
      expect(formatInlineCitation(twoAuthors, 'abnt', 1)).toBe('(VASWANI; SHAZEER, 2017)');
    });

    it('formats 20+ authors in APA style with ellipsis', () => {
      const manyAuthors: Author[] = Array.from({ length: 22 }, (_, i) => ({
        familyName: `Author${i + 1}`,
        givenName: `First${i + 1}`,
      }));
      const paperMany: BibliographicReference = {
        id: 'p-many',
        title: 'Genome Sequencing Consortium',
        authors: manyAuthors,
        year: 2021,
        extractionStatus: 'ok',
      };
      const entry = formatBibliographyEntry(paperMany, 'apa', 1);
      expect(entry).toContain('...');
      expect(entry).toContain('Author22, F.');
    });
  });

  describe('generateBibliography', () => {
    it('generates a complete formatted bibliography list with markers and entries', () => {
      const result = generateBibliography([samplePaper], 'apa');
      expect(result).toHaveLength(1);
      expect(result[0]?.referenceId).toBe('paper-1');
      expect(result[0]?.inlineMarker).toBe('(Vaswani et al., 2017)');
      expect(result[0]?.bibliographyEntry).toContain('Vaswani, A.');
      expect(result[0]?.index).toBe(1);
      expect(result[0]?.style).toBe('apa');
    });
  });

  describe('parseZoteroJson', () => {
    it('parses raw CSL-JSON objects array', () => {
      const cslJson = [
        {
          id: 'item-1',
          title: 'Deep Residual Learning for Image Recognition',
          author: [{ family: 'He', given: 'Kaiming' }, { family: 'Zhang', given: 'Xiangyu' }],
          issued: { 'date-parts': [[2016]] },
          'container-title': 'CVPR',
          DOI: '10.1109/CVPR.2016.90',
        },
      ];

      const parsed = parseZoteroJson(cslJson);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.title).toBe('Deep Residual Learning for Image Recognition');
      expect(parsed[0]?.authors).toHaveLength(2);
      expect(parsed[0]?.authors[0]?.familyName).toBe('He');
      expect(parsed[0]?.year).toBe(2016);
      expect(parsed[0]?.doi).toBe('10.1109/CVPR.2016.90');
    });

    it('parses Zotero API wrapper items from JSON string', () => {
      const zoteroApiPayload = JSON.stringify([
        {
          key: 'ZOTERO123',
          data: {
            title: 'Language Models are Few-Shot Learners',
            creators: [{ lastName: 'Brown', firstName: 'Tom' }, { name: 'OpenAI' }],
            date: '2020-05-28',
            publicationTitle: 'NeurIPS',
          },
        },
      ]);

      const parsed = parseZoteroJson(zoteroApiPayload);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.id).toBe('ZOTERO123');
      expect(parsed[0]?.title).toBe('Language Models are Few-Shot Learners');
      expect(parsed[0]?.authors[0]?.familyName).toBe('Brown');
      expect(parsed[0]?.authors[1]?.familyName).toBe('OpenAI');
      expect(parsed[0]?.year).toBe(2020);
    });

    it('handles malformed JSON string by returning empty list', () => {
      expect(parseZoteroJson('invalid-json{{{')).toEqual([]);
    });

    it('reaches 100% branch coverage on style and parsing edge cases', () => {
      const twoAuthors: BibliographicReference = {
        id: 'two',
        title: 'Pair Study',
        authors: [
          { familyName: 'Kaplan', givenName: 'Jared' },
          { familyName: 'Gray', givenName: 'Chase' },
        ],
        year: 2020,
        extractionStatus: 'ok',
      };

      // Bibliography APA with exactly two authors uses the ", &" join
      const apaTwo = formatBibliographyEntry(twoAuthors, 'apa');
      expect(apaTwo).toContain('Kaplan, J., & Gray, C.');
      expect(apaTwo).not.toContain('et al');

      // Chicago bibliography with more than three authors falls back to et al.
      const fourAuthors: BibliographicReference = {
        ...twoAuthors,
        id: 'four',
        title: 'Big Team Study',
        authors: [
          { familyName: 'One', givenName: 'A' },
          { familyName: 'Two', givenName: 'B' },
          { familyName: 'Three', givenName: 'C' },
          { familyName: 'Four', givenName: 'D' },
        ],
      };
      expect(formatBibliographyEntry(fourAuthors, 'chicago')).toContain('One, A., et al.');

      // Unknown style falls through to the default bibliography template
      const unknownStyle = formatBibliographyEntry(twoAuthors, 'nature-x' as never);
      expect(unknownStyle).toBe('Kaplan, J. and Gray, C. (2020). Pair Study.');

      // Zotero creators without recognizable name fields yield an Unknown author
      const noNameCreators = parseZoteroJson([
        { data: { title: 'Anonymous Work', creators: [{ role: 'editor', extra: true }] } },
      ]);
      expect(noNameCreators).toHaveLength(1);
      expect(noNameCreators[0]?.authors[0]?.familyName).toBe('Unknown');
    });
  });
});

describe('Citation Styles — exhaustive branch matrix', () => {
  const A = (familyName: string, givenName?: string): Author =>
    givenName ? { familyName, givenName } : { familyName };

  const ALL_STYLES = [
    'apa', 'mla', 'chicago', 'ieee', 'harvard', 'vancouver',
    'nature', 'science', 'acm', 'acs', 'chicago-notes', 'turabian',
    'ama', 'nlm', 'cse', 'apsa', 'asa', 'aaa', 'mhra', 'oxford',
    'oscola', 'bluebook', 'abnt', 'iso690', 'gbt7714', 'cell',
  ] as const;

  const fullRef: BibliographicReference = {
    id: 'full', title: 'Complete Study.', authors: [A('One', 'Alice'), A('Two', 'Bob')],
    year: 2024, journal: 'Journal of Tests', booktitle: 'Proc of Tests', publisher: 'Test Press',
    volume: '7', issue: '3', pages: '100-110', doi: '10.1000/full', url: 'https://x.org',
    extractionStatus: 'ok',
  };
  const booktitleRef: BibliographicReference = { ...fullRef, id: 'bt', journal: undefined };
  const publisherRef: BibliographicReference = { ...fullRef, id: 'pub', journal: undefined, booktitle: undefined };
  const bareRef: BibliographicReference = {
    id: 'bare', title: 'Bare', authors: [], year: undefined,
    journal: undefined, booktitle: undefined, publisher: undefined,
    volume: undefined, issue: undefined, pages: undefined, doi: undefined,
    extractionStatus: 'ok',
  };

  it('formats every style against full, venue-variant, and bare references', () => {
    for (const style of ALL_STYLES) {
      for (const ref of [fullRef, booktitleRef, publisherRef, bareRef]) {
        const entry = formatBibliographyEntry(ref, style as CitationStyle, 3);
        expect(typeof entry).toBe('string');
        expect(entry.length).toBeGreaterThan(0);
      }
      const marker = formatInlineCitation(fullRef, style as CitationStyle, 5, 12);
      expect(typeof marker).toBe('string');

      // Inline two-author switch arms (apa/harvard vs mla/chicago vs default)
      const twoAuthors: BibliographicReference = { ...fullRef, authors: [A('Alpha'), A('Beta')] };
      expect(typeof formatInlineCitation(twoAuthors, style as CitationStyle, 1)).toBe('string');
      expect(formatInlineAuthors(twoAuthors.authors, style as CitationStyle)).toBeTruthy();

      // Three-plus authors path per style
      const many: BibliographicReference = {
        ...fullRef,
        authors: [A('One'), A('Two'), A('Three'), A('Four'), A('Five'), A('Six'), A('Seven')],
      };
      expect(typeof formatInlineCitation(many, style as CitationStyle, 9)).toBe('string');
      expect(formatInlineAuthors(many.authors, style as CitationStyle)).toContain('et al');
      expect(typeof formatBibliographyEntry(many, style as CitationStyle)).toBe('string');
    }

    // Unknown style reaches both inline and bibliography defaults
    expect(formatInlineCitation(bareRef, 'mystery' as never)).toContain('n.d.');
    expect(typeof formatBibliographyEntry(bareRef, 'mystery' as never)).toBe('string');
  });

  it('covers bibliography author-shape branches across representative styles', () => {
    // literal-only author short-circuits initials logic
    const literalAuthor: BibliographicReference = {
      ...bareRef, authors: [{ familyName: 'OpenAI', literal: 'OpenAI' }],
    };
    expect(formatBibliographyEntry(literalAuthor, 'vancouver')).toContain('OpenAI');

    // family-only author skips initial formation
    const familyOnly: BibliographicReference = { ...bareRef, authors: [A('Solo')] };
    expect(formatBibliographyEntry(familyOnly, 'ieee')).toContain('Solo');

    // vancouver & ieee invert into "Fam I" / "I. Fam" shapes
    const given: BibliographicReference = { ...bareRef, authors: [A('Curie', 'Marie')] };
    expect(formatBibliographyEntry(given, 'vancouver')).toContain('Curie M');
    expect(formatBibliographyEntry(given, 'ieee')).toContain('M. Curie');

    // Defensive ternaries reachable through sparse author arrays
    const sevenSparse = new Array(7);
    sevenSparse[1] = A('Present');
    const sparseSeven: BibliographicReference = { ...bareRef, authors: sevenSparse as unknown as Author[] };
    expect(formatBibliographyEntry(sparseSeven, 'ieee')).toContain('Unknown Author');

    const twentyOne = new Array(21);
    twentyOne[0] = A('Head');
    const sparseTail: BibliographicReference = { ...bareRef, authors: twentyOne as unknown as Author[] };
    expect(formatBibliographyEntry(sparseTail, 'apa')).not.toContain(', & ,');

    const threeHoleFirst = new Array(4);
    threeHoleFirst[3] = A('Tail');
    const holeHead: BibliographicReference = { ...bareRef, authors: threeHoleFirst as unknown as Author[] };
    expect(formatBibliographyEntry(holeHead, 'chicago')).toContain('Unknown Author');
    expect(formatBibliographyEntry(holeHead, 'harvard')).toContain('Unknown Author');

    // MLA/Chicago author-template givenName fallbacks
    const pairNoGivens: BibliographicReference = { ...bareRef, authors: [A('Aa'), A('Bb')] };
    expect(formatBibliographyEntry(pairNoGivens, 'mla')).toMatch(/and\s+Bb/);
    expect(formatBibliographyEntry(pairNoGivens, 'chicago')).toMatch(/Aa, and\s+Bb/);

    const trioNoGivens: BibliographicReference = {
      ...bareRef, authors: [A('Aa'), A('Bb'), A('Cc')],
    };
    expect(formatBibliographyEntry(trioNoGivens, 'chicago')).toContain('Bb');
    expect(formatBibliographyEntry(trioNoGivens, 'chicago')).toMatch(/and\s+Cc/);
  });

  it('maps alternate Zotero/CSL field names onto references', () => {
    const parsed = parseZoteroJson([
      {
        // data.key + name-title + literal creator + issued.date-parts + URL/page variants
        data: {
          key: 'ALTKEY1',
          name: 'Named Entity Work',
          creators: [{ literal: 'Institution Name' }],
          issued: { 'date-parts': [[2019]] },
          doi: '10.1/alt-doi',
          URL: 'https://alt.example',
          journalAbbreviation: 'JAT',
          page: '5-6',
          abstract: 'Alt abstract',
        },
      },
      {
        // generated id + familyName/givenName creators + date + publicationTitle + volume/issue numbers
        data: {
          title: 'Second Item',
          creators: [{ familyName: 'Family', givenName: 'Given' }],
          date: 'March 2021',
          publicationTitle: 'Venue',
          volume: 4,
          issue: 2,
          publisher: 'PubCo',
        },
      },
      {
        // CSL author array incl. fallback family names
        id: 'third-id',
        title: 'Third Item',
        author: [
          { lastName: 'LastOnly' },
          { name: 'NameOnly' },
          {},
        ],
        year: 2005,
      },
    ]);

    expect(parsed).toHaveLength(3);
    expect(parsed[0]?.id).toBe('ALTKEY1');
    expect(parsed[0]?.authors[0]?.literal).toBe('Institution Name');
    expect(parsed[0]?.year).toBe(2019);
    expect(parsed[0]?.doi).toBe('10.1/alt-doi');
    expect(parsed[0]?.url).toBe('https://alt.example');
    expect(parsed[0]?.journal).toBe('JAT');
    expect(parsed[0]?.pages).toBe('5-6');
    expect(parsed[1]?.id).toMatch(/^zotero-2-\d+$/);
    expect(parsed[1]?.authors[0]?.familyName).toBe('Family');
    expect(parsed[1]?.year).toBe(2021);
    expect(parsed[1]?.journal).toBe('Venue');
    expect(parsed[1]?.volume).toBe('4');
    expect(parsed[1]?.issue).toBe('2');
    expect(parsed[2]?.authors.map((a) => a.familyName)).toEqual(['LastOnly', 'NameOnly', 'Unknown']);
  });
});

describe('Citation Styles — final fallback arms', () => {
  const A = (familyName: string, givenName?: string): Author =>
    givenName ? { familyName, givenName } : { familyName };

  const bareRef: BibliographicReference = {
    id: 'bare', title: 'Bare', authors: [], year: undefined,
    journal: undefined, booktitle: undefined, publisher: undefined,
    volume: undefined, issue: undefined, pages: undefined, doi: undefined,
    extractionStatus: 'ok',
  };

  it('inline formatting falls back to Unknown for nameless and sparse authors', () => {
    // getFamily literal and final-Unknown arms
    expect(formatInlineAuthors([{ familyName: '', literal: 'Lit' }, {}] as Author[], 'apa')).toBe(
      'Lit & Unknown'
    );
    // et-al path with a hole at the head -> authors[0] falsy
    const sparse = new Array(3);
    sparse[1] = { familyName: 'Mid' };
    expect(formatInlineAuthors(sparse as unknown as Author[], 'apa')).toBe('Unknown et al.');
  });

  it('bibliography formatSingle tolerates authors with no names at all', () => {
    const nameless: BibliographicReference = {
      id: 'n', title: 'Nameless', authors: [{} as Author], extractionStatus: 'ok',
    };
    // family/given both fall back to empty strings -> author segment collapses
    expect(formatBibliographyEntry(nameless, 'apa')).toBe('(n.d.). Nameless.');
  });

  it('apa bibliography omits the trailing join when the last slot is a hole', () => {
    const pair = new Array(2);
    pair[0] = A('Head');
    const sparsePair: BibliographicReference = { ...bareRef, authors: pair as unknown as Author[] };
    const out = formatBibliographyEntry(sparsePair, 'apa');
    expect(out).toBe('Head (n.d.). Bare.');
    expect(out).not.toContain(', &');

    const sparseThree = new Array(3);
    sparseThree[0] = A('Lead');
    expect(formatBibliographyEntry({ ...bareRef, authors: sparseThree as unknown as Author[] }, 'mla')).toBe(
      'Lead, et al.. "Bare."'
    );

    // MLA falls back to Unknown Author when the first slot itself is a hole
    const mlaHoleHead = new Array(3);
    mlaHoleHead[1] = A('Mid');
    expect(
      formatBibliographyEntry({ ...bareRef, authors: mlaHoleHead as unknown as Author[] }, 'mla')
    ).toBe('Unknown Author. "Bare."');
  });

  it('parses Zotero JSON from raw strings and honors data.id plus unparseable dates', () => {
    const stringInput = parseZoteroJson(
      JSON.stringify([
        { data: { id: 'data-id-9', title: 'String Parsed', date: 'sometime long ago' } },
      ])
    );
    expect(stringInput[0]?.id).toBe('data-id-9');
    expect(stringInput[0]?.year).toBeUndefined();
  });
});

it('accepts a single non-array Zotero item object directly', () => {
  const single = parseZoteroJson({
    data: { id: 'direct-id', title: 'Single Item', creators: [{ lastName: 'Solo' }] },
  } as never);
  expect(single).toHaveLength(1);
  expect(single[0]?.id).toBe('direct-id');
});

it('resolves identifiers from data.id when no Zotero keys exist', () => {
  const viaDataId = parseZoteroJson([
    { data: { id: 'plain-data-id', title: 'Via Data Id', creators: [] } },
  ]);
  expect(viaDataId[0]?.id).toBe('plain-data-id');
});

it('falls back to Untitled Document when an item has no title or name', () => {
  const untitled = parseZoteroJson([{ data: { key: 'NO-TITLE', creators: [] } }]);
  expect(untitled[0]?.id).toBe('NO-TITLE');
  expect(untitled[0]?.title).toBe('Untitled Document');
});
