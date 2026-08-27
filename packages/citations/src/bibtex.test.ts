import { describe, it, expect } from 'vitest';
import {
  generateCitationKey,
  parseBibtexAuthors,
  serializeBibtexAuthors,
  extractBibtexFields,
  parseBibtex,
  formatBibtexEntry,
  formatBibtexDatabase,
} from './bibtex';
import { Author, BibliographicReference } from './types';

describe('BibTeX Module', () => {
  describe('generateCitationKey', () => {
    it('generates a key from first author family name, year, and first title word', () => {
      const ref: Partial<BibliographicReference> = {
        authors: [{ familyName: 'Vaswani', givenName: 'Ashish' }],
        year: 2017,
        title: 'Attention Is All You Need',
      };
      expect(generateCitationKey(ref)).toBe('vaswani2017attention');
    });

    it('strips leading articles like "The", "A", "An" from title', () => {
      const ref: Partial<BibliographicReference> = {
        authors: [{ familyName: 'Goodfellow', givenName: 'Ian' }],
        year: 2014,
        title: 'Generative Adversarial Nets',
      };
      expect(generateCitationKey(ref)).toBe('goodfellow2014generative');

      const refWithThe: Partial<BibliographicReference> = {
        authors: [{ familyName: 'Devlin', givenName: 'Jacob' }],
        year: 2018,
        title: 'The BERT Architecture',
      };
      expect(generateCitationKey(refWithThe)).toBe('devlin2018bert');
    });

    it('handles missing authors or titles gracefully', () => {
      const ref: Partial<BibliographicReference> = {};
      const key = generateCitationKey(ref);
      expect(key).toContain('ref');
      expect(key).toContain('paper');
    });
  });

  describe('parseBibtexAuthors', () => {
    it('parses "LastName, FirstName and Other, First" format', () => {
      const input = 'Vaswani, Ashish and Shazeer, Noam and Parmar, Niki';
      const authors = parseBibtexAuthors(input);
      expect(authors).toHaveLength(3);
      expect(authors[0]).toEqual({
        familyName: 'Vaswani',
        givenName: 'Ashish',
        literal: 'Vaswani, Ashish',
      });
      expect(authors[1]).toEqual({
        familyName: 'Shazeer',
        givenName: 'Noam',
        literal: 'Shazeer, Noam',
      });
    });

    it('parses "First Last and First Last" format', () => {
      const input = 'Ashish Vaswani and Noam Shazeer';
      const authors = parseBibtexAuthors(input);
      expect(authors).toHaveLength(2);
      expect(authors[0]).toEqual({
        familyName: 'Vaswani',
        givenName: 'Ashish',
        literal: 'Ashish Vaswani',
      });
    });

    it('handles single word author and corporate authors with braces', () => {
      const input = '{OpenAI} and Plato';
      const authors = parseBibtexAuthors(input);
      expect(authors).toHaveLength(2);
      expect(authors[0]?.familyName).toBe('OpenAI');
      expect(authors[1]?.familyName).toBe('Plato');
    });

    it('handles empty or whitespace string', () => {
      const authors = parseBibtexAuthors('');
      expect(authors).toHaveLength(1);
      expect(authors[0]?.familyName).toBe('Unknown Author');
    });
  });

  describe('serializeBibtexAuthors', () => {
    it('serializes authors to "LastName, FirstName and ..." format', () => {
      const authors = [
        { familyName: 'Vaswani', givenName: 'Ashish' },
        { familyName: 'Shazeer', givenName: 'Noam' },
      ];
      expect(serializeBibtexAuthors(authors)).toBe('Vaswani, Ashish and Shazeer, Noam');
    });

    it('falls back to literal or familyName if givenName missing', () => {
      const authors = [{ familyName: 'OpenAI' }];
      expect(serializeBibtexAuthors(authors)).toBe('OpenAI');
    });

    it('returns "Unknown Author" if empty list', () => {
      expect(serializeBibtexAuthors([])).toBe('Unknown Author');
    });
  });

  describe('extractBibtexFields', () => {
    it('handles balanced nested braces correctly', () => {
      const body = 'title = {Self-Supervised Learning for {DNA} Sequencing}, year = {2023}, journal = {Nature}';
      const fields = extractBibtexFields(body);
      expect(fields.title).toBe('Self-Supervised Learning for {DNA} Sequencing');
      expect(fields.year).toBe('2023');
      expect(fields.journal).toBe('Nature');
    });

    it('handles double quoted fields and escaped quotes', () => {
      const body = 'title = "Deep Learning with \\"Attention\\" Mechanisms", author = "LeCun, Yann"';
      const fields = extractBibtexFields(body);
      expect(fields.title).toBe('Deep Learning with \\"Attention\\" Mechanisms');
      expect(fields.author).toBe('LeCun, Yann');
    });

    it('handles unquoted numeric or identifier fields', () => {
      const body = 'year = 2021, volume = 42, month = jan';
      const fields = extractBibtexFields(body);
      expect(fields.year).toBe('2021');
      expect(fields.volume).toBe('42');
      expect(fields.month).toBe('jan');
    });
  });

  describe('parseBibtex', () => {
    it('parses a multi-entry BibTeX string into structured reference objects', () => {
      const bibtex = `
        @article{vaswani2017attention,
          title = {Attention Is All You Need},
          author = {Vaswani, Ashish and Shazeer, Noam},
          journal = {Advances in Neural Information Processing Systems},
          year = {2017},
          volume = {30},
          pages = {5998--6008},
          doi = {10.5555/3295222.3295349}
        }

        @inproceedings{devlin2018bert,
          title = {BERT: Pre-training of Deep Bidirectional Transformers},
          author = {Devlin, Jacob and Chang, Ming-Wei},
          booktitle = {NAACL-HLT},
          year = {2019},
          eprint = {1810.04805},
          archivePrefix = {arXiv}
        }
      `;

      const result = parseBibtex(bibtex);
      expect(result.totalParsed).toBe(2);
      expect(result.entries).toHaveLength(2);

      const first = result.entries[0]!;
      expect(first.citationKey).toBe('vaswani2017attention');
      expect(first.entryType).toBe('article');
      expect(first.title).toBe('Attention Is All You Need');
      expect(first.authors).toHaveLength(2);
      expect(first.year).toBe(2017);
      expect(first.journal).toBe('Advances in Neural Information Processing Systems');
      expect(first.doi).toBe('10.5555/3295222.3295349');

      const second = result.entries[1]!;
      expect(second.citationKey).toBe('devlin2018bert');
      expect(second.entryType).toBe('inproceedings');
      expect(second.arxivId).toBe('1810.04805');
    });

    it('returns empty result for empty or whitespace content', () => {
      expect(parseBibtex('').totalParsed).toBe(0);
      expect(parseBibtex('   \n  ').entries).toEqual([]);
    });

    it('handles unrecognized entry types by falling back to misc', () => {
      const bibtex = `@customtype{custom2022, title = {Custom Document}}`;
      const result = parseBibtex(bibtex);
      expect(result.totalParsed).toBe(1);
      expect(result.entries[0]?.entryType).toBe('misc');
    });
  });

  describe('formatBibtexEntry and formatBibtexDatabase', () => {
    it('formats a BibliographicReference into valid BibTeX string', () => {
      const ref: BibliographicReference = {
        id: 'ref-1',
        citationKey: 'vaswani2017attention',
        entryType: 'article',
        title: 'Attention Is All You Need',
        authors: [{ familyName: 'Vaswani', givenName: 'Ashish' }],
        year: 2017,
        journal: 'NeurIPS',
        booktitle: 'Proc. NeurIPS',
        volume: '30',
        issue: '1',
        pages: '1-10',
        publisher: 'Curran Associates',
        doi: '10.1234/test',
        url: 'https://example.com/paper',
        arxivId: '1706.03762',
        pmid: '12345678',
        abstract: 'Line 1\nLine 2',
        extractionStatus: 'ok',
      };

      const formatted = formatBibtexEntry(ref);
      expect(formatted).toContain('@article{vaswani2017attention,');
      expect(formatted).toContain('title = {Attention Is All You Need}');
      expect(formatted).toContain('author = {Vaswani, Ashish}');
      expect(formatted).toContain('year = {2017}');
      expect(formatted).toContain('doi = {10.1234/test}');
      expect(formatted).toContain('eprint = {1706.03762}');
      expect(formatted).toContain('archivePrefix = {arXiv}');
      expect(formatted).toContain('pmid = {12345678}');
      expect(formatted).toContain('abstract = {Line 1 Line 2}');
    });

    it('formats multiple entries into a database string', () => {
      const refs: BibliographicReference[] = [
        {
          id: 'ref-1',
          citationKey: 'p1',
          entryType: 'article',
          title: 'Paper 1',
          authors: [{ familyName: 'Smith' }],
          year: 2020,
          extractionStatus: 'ok',
        },
        {
          id: 'ref-2',
          citationKey: 'p2',
          entryType: 'book',
          title: 'Paper 2',
          authors: [{ familyName: 'Jones' }],
          year: 2021,
          extractionStatus: 'ok',
        },
      ];

      const db = formatBibtexDatabase(refs);
      expect(db).toContain('@article{p1,');
      expect(db).toContain('@book{p2,');
    });
  });

  describe('100% coverage edge branches', () => {
    it('falls back to a placeholder title when entry has neither title nor booktitle', () => {
      const result = parseBibtex(`@misc{noTitle2020,\n  author = {Smith, Jane},\n  year = {2020}\n}`);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe('Untitled BibTeX Entry (noTitle2020)');
    });

    it('generates a synthetic id when the cite key trims to empty', () => {
      const result = parseBibtex('@article{ , title = {Some Title}}');
      expect(result.totalParsed).toBe(1);
      expect(result.entries[0].id).toMatch(/^bib-\d+-[a-z0-9]+$/);
    });

    it('infers entry type from journal or booktitle and synthesizes citation keys on format', () => {
      const journalOnly = {
        id: 'r1',
        title: 'Journal Paper',
        authors: [{ familyName: 'Vaswani', givenName: 'Ashish' }],
        year: 2017,
        journal: 'NeurIPS',
        extractionStatus: 'ok',
      } as BibliographicReference;

      const booktitleOnly = {
        id: 'r2',
        title: 'Conference Paper',
        authors: [{ familyName: 'LeCun' }],
        booktitle: 'CVPR',
        extractionStatus: 'ok',
      } as BibliographicReference;

      const bare = {
        id: 'r3',
        title: 'Loose Note',
        authors: [],
        extractionStatus: 'ok',
      } as BibliographicReference;

      expect(formatBibtexEntry(journalOnly)).toMatch(/^@article\{vaswani2017journal,/);
      expect(formatBibtexEntry(booktitleOnly)).toMatch(/^@inproceedings\{lecun\d+conference,/);
      expect(formatBibtexEntry(bare)).toMatch(/^@misc\{ref\d+(doc|paper|note|loose),/);
    });

    it('serializes every optional field into the formatted entry', () => {
      const full: BibliographicReference = {
        id: 'full',
        citationKey: 'fullKey',
        entryType: 'article',
        title: 'Everything Included',
        authors: [
          { familyName: 'Two', givenName: 'Author' },
          { familyName: 'Org', literal: 'Org Name' },
        ],
        year: 2024,
        journal: 'J',
        volume: '9',
        issue: '2',
        pages: '1-10',
        publisher: 'Pub',
        doi: '10.1000/full',
        url: 'https://example.org',
        arxivId: '2401.00001',
        pmid: '12345678',
        abstract: 'Line one.\n\nLine two.',
        extractionStatus: 'ok',
      };

      const out = formatBibtexEntry(full);
      expect(out).toContain('@article{fullKey,');
      expect(out).toContain('year = {2024}');
      expect(out).toContain('journal = {J}');
      expect(out).toContain('volume = {9}');
      expect(out).toContain('number = {2}');
      expect(out).toContain('pages = {1-10}');
      expect(out).toContain('publisher = {Pub}');
      expect(out).toContain('doi = {10.1000/full}');
      expect(out).toContain('url = {https://example.org}');
      expect(out).toContain('archivePrefix = {arXiv}');
      expect(out).toContain('eprint = {2401.00001}');
      expect(out).toContain('pmid = {12345678}');
      expect(out).toContain('abstract = {Line one. Line two.}');

      // Round-trip: serialized output re-parses to equivalent reference
      const reparsed = parseBibtex(out);
      expect(reparsed.totalParsed).toBe(1);
      expect(reparsed.entries[0].arxivId).toBe('2401.00001');
      expect(reparsed.entries[0].pmid).toBeUndefined();
    });

    it('handles quoted fields with escaped quotes and bare numeric values', () => {
      const bib = `@article{esc,
        title = "Escaped \\"Quote\\" Study",
        year = 2023
      }`;
      const result = parseBibtex(bib);
      expect(result.totalParsed).toBe(1);
      expect(result.entries[0].title).toBe('Escaped \\"Quote\\" Study');
      expect(result.entries[0].year).toBe(2023);
    });

    it('skips malformed junk between entries without failing', () => {
      const bib = `
        some random prose that is not an entry
        @misc{junk1, title={Fine}}
      `;
      const result = parseBibtex(bib);
      expect(result.totalParsed).toBe(1);
      expect(result.entries[0].citationKey).toBe('junk1');
    });
  });
});

describe('BibTeX Module — remaining parser/serializer branches', () => {
  it('handles field bodies that end without value or terminator', () => {
    // key with '=' then immediate end-of-body -> break at pos>=len guard
    const danglingEquals = parseBibtex('@misc{dangling,\n  title =');
    expect(danglingEquals.totalParsed).toBe(1);

    // bare value terminated only by end-of-string
    const eofValue = parseBibtex('@misc{eof,\n  year = 2023');
    expect(eofValue.entries[0]?.year).toBe(2023);
  });

  it('skips trailing separators and stops cleanly at end of body', () => {
    const trailing = parseBibtex('@misc{trailing,\n  title = {Done},   ');
    expect(trailing.entries[0]?.title).toBe('Done');
  });

  it('extracts an unterminated brace value up to end of body', () => {
    const unbalanced = parseBibtex('@misc{unb,\n  title = {never closed');
    expect(unbalanced.entries[0]?.title).toBe('never closed');
  });

  it('generates doc fallback keys and Unknown author components', () => {
    // article-stripped title leaves an empty first word -> 'doc'
    const key = generateCitationKey({ authors: [{ familyName: 'Rowe' }], year: 2020, title: 'The ' });
    expect(key).toBe('rowe2020doc');

    // leading-comma author -> familyName falls back to Unknown
    const parsed = parseBibtexAuthors(', Jane');
    expect(parsed[0]?.familyName).toBe('Unknown');

    // trailing comma strips givenName to undefined
    const noGiven = parseBibtexAuthors('Smith,');
    expect(noGiven[0]?.familyName).toBe('Smith');
    expect(noGiven[0]?.givenName).toBeUndefined();

    // empty single-part author falls back to Unknown
    const blankSecond = parseBibtexAuthors('Vas and ');
    expect(blankSecond[1]?.familyName).toBe('Unknown');

      // serializer's final fallback for objects lacking names
      expect(serializeBibtexAuthors([{} as unknown as Author])).toBe('Unknown');
  });
});

it('tolerates an unterminated quoted value at end of input', () => {
  const result = parseBibtex('@misc{openquote,\n  title = "never closed');
  expect(result.totalParsed).toBe(1);
});
