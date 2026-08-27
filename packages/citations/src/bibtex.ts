/**
 * BibTeX Parser & Serializer
 * Supports importing and exporting .bib records for OpenResearch
 */

import { Author, BibliographicReference, BibtexParseResult, EntryType } from './types';

/**
 * Generate a standardized citation key if none exists.
 * e.g. vaswani2017attention
 */
export function generateCitationKey(ref: Partial<BibliographicReference>): string {
  const firstAuthor = ref.authors?.[0]?.familyName || 'ref';
  const cleanAuthor = firstAuthor.toLowerCase().replace(/[^a-z0-9]/g, '');
  const year = ref.year || new Date().getFullYear();
  const firstWord = (ref.title || 'paper')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .split(/\s+/)[0]
    .replace(/[^a-z0-9]/g, '');

  return `${cleanAuthor}${year}${firstWord || 'doc'}`;
}

/**
 * Parse an author string from BibTeX format.
 * Handles "LastName, FirstName and Other, First" or "First Last and First Last"
 */
export function parseBibtexAuthors(authorStr: string): Author[] {
  if (!authorStr || !authorStr.trim()) {
    return [{ familyName: 'Unknown Author', literal: 'Unknown Author' }];
  }

  const rawAuthors = authorStr.split(/\s+and\s+/i);
  return rawAuthors.map((raw) => {
    const trimmed = raw.trim().replace(/^\{+|\}+$/g, '');
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',').map((p) => p.trim());
      return {
        familyName: parts[0] || 'Unknown',
        givenName: parts.slice(1).join(' ') || undefined,
        literal: trimmed,
      };
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return {
        familyName: parts[0] || 'Unknown',
        literal: trimmed,
      };
    }
    const familyName = parts[parts.length - 1];
    const givenName = parts.slice(0, -1).join(' ');
    return {
      familyName,
      givenName,
      literal: trimmed,
    };
  });
}

/**
 * Serialize an array of Authors to BibTeX "and" format.
 */
export function serializeBibtexAuthors(authors: Author[]): string {
  if (!authors || authors.length === 0) return 'Unknown Author';
  return authors
    .map((a) => {
      if (a.familyName && a.givenName) {
        return `${a.familyName}, ${a.givenName}`;
      }
      return a.familyName || a.literal || 'Unknown';
    })
    .join(' and ');
}

/**
 * Extract key-value fields from a BibTeX entry body with support for balanced nested braces.
 */
export function extractBibtexFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let pos = 0;
  const len = body.length;

  while (pos < len) {
    // Skip whitespace and separating commas
    while (pos < len) {
      const ch: string | undefined = body[pos];
      if (ch === undefined || !/[\s,]/.test(ch)) break;
      pos++;
    }
    if (pos >= len) break;

    const keyMatch = body.slice(pos).match(/^([a-zA-Z0-9_-]+)\s*=\s*/);
    if (!keyMatch) {
      pos++;
      continue;
    }

    const key = keyMatch[1].toLowerCase().trim();
    pos += keyMatch[0].length;

    if (!key || pos >= len) break;

    let value = '';
    const firstChar = body[pos];

    if (firstChar === '{') {
      pos++;
      let depth = 1;
      const start = pos;
      while (pos < len && depth > 0) {
        if (body[pos] === '{') depth++;
        else if (body[pos] === '}') depth--;
        pos++;
      }
      const end = depth === 0 ? pos - 1 : pos;
      value = body.slice(start, end);
    } else if (firstChar === '"') {
      pos++;
      const start = pos;
      while (pos < len && body[pos] !== '"') {
        if (body[pos] === '\\' && pos + 1 < len) {
          pos += 2;
        } else {
          pos++;
        }
      }
      value = body.slice(start, pos);
      if (pos < len && body[pos] === '"') pos++;
    } else {
      const start = pos;
      while (pos < len) {
        const ch: string | undefined = body[pos];
        if (ch === undefined || /[,\s}\n\r]/.test(ch)) break;
        pos++;
      }
      value = body.slice(start, pos);
    }

    fields[key] = value.trim();
  }

  return fields;
}

/**
 * Parse a BibTeX string (.bib content) into structured BibliographicReference objects.
 */
export function parseBibtex(bibtexContent: string): BibtexParseResult {
  const entries: BibliographicReference[] = [];
  const errors: string[] = [];

  if (!bibtexContent || !bibtexContent.trim()) {
    return { entries: [], errors: [], totalParsed: 0 };
  }

  // Regex to match BibTeX entry header: @type{key, ...
  const entryRegex = /@([a-zA-Z]+)\s*\{\s*([^,]+),([\s\S]*?)(?=(?:\r?\n\s*@|\s*$))/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(bibtexContent)) !== null) {
    // The regex guarantees all three capture groups participate on a match.
    const rawType = match[1].toLowerCase();
    const citeKey = match[2].trim();
    const body = match[3];

    const fields = extractBibtexFields(body);

    const title = fields.title || fields.booktitle || `Untitled BibTeX Entry (${citeKey})`;
    const authors = parseBibtexAuthors(fields.author || fields.editor || '');
    const year = fields.year ? parseInt(fields.year.replace(/[^0-9]/g, ''), 10) : undefined;
    const doi = fields.doi;
    const journal = fields.journal || fields.journaltitle;
    const booktitle = fields.booktitle;
    const volume = fields.volume;
    const issue = fields.number || fields.issue;
    const pages = fields.pages;
    const publisher = fields.publisher || fields.institution || fields.school;
    const abstract = fields.abstract;
    const url = fields.url || fields.eprint;
    const arxivId = fields.eprint && fields.archiveprefix?.toLowerCase() === 'arxiv' ? fields.eprint : undefined;

    const normalizedEntryType: EntryType = [
      'article',
      'inproceedings',
      'conference',
      'book',
      'incollection',
      'phdthesis',
      'mastersthesis',
      'techreport',
      'misc',
      'unpublished',
    ].includes(rawType)
      ? (rawType as EntryType)
      : 'misc';

    const ref: BibliographicReference = {
      id: citeKey || `bib-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      citationKey: citeKey,
      entryType: normalizedEntryType,
      title,
      authors,
      year: isNaN(year as number) ? undefined : year,
      doi,
      arxivId,
      journal,
      booktitle,
      volume,
      issue,
      pages,
      publisher,
      abstract,
      url,
      bibtex: match[0].trim(),
      extractionStatus: 'ok',
    };

    entries.push(ref);
  }

  return {
    entries,
    errors,
    totalParsed: entries.length,
  };
}

/**
 * Format a single BibliographicReference into standard BibTeX string.
 */
export function formatBibtexEntry(ref: BibliographicReference): string {
  const type = ref.entryType || (ref.journal ? 'article' : ref.booktitle ? 'inproceedings' : 'misc');
  const key = ref.citationKey || generateCitationKey(ref);
  const authors = serializeBibtexAuthors(ref.authors);

  const fields: string[] = [
    `  title = {${ref.title}}`,
    `  author = {${authors}}`,
  ];

  if (ref.year) fields.push(`  year = {${ref.year}}`);
  if (ref.journal) fields.push(`  journal = {${ref.journal}}`);
  if (ref.booktitle) fields.push(`  booktitle = {${ref.booktitle}}`);
  if (ref.volume) fields.push(`  volume = {${ref.volume}}`);
  if (ref.issue) fields.push(`  number = {${ref.issue}}`);
  if (ref.pages) fields.push(`  pages = {${ref.pages}}`);
  if (ref.publisher) fields.push(`  publisher = {${ref.publisher}}`);
  if (ref.doi) fields.push(`  doi = {${ref.doi}}`);
  if (ref.url) fields.push(`  url = {${ref.url}}`);
  if (ref.arxivId) {
    fields.push(`  archivePrefix = {arXiv}`);
    fields.push(`  eprint = {${ref.arxivId}}`);
  }
  if (ref.pmid) fields.push(`  pmid = {${ref.pmid}}`);
  if (ref.abstract) fields.push(`  abstract = {${ref.abstract.replace(/\n+/g, ' ')}}`);

  return `@${type}{${key},\n${fields.join(',\n')}\n}`;
}

/**
 * Format an array of BibliographicReference into a complete multi-entry .bib document.
 */
export function formatBibtexDatabase(references: BibliographicReference[]): string {
  return references.map(formatBibtexEntry).join('\n\n');
}
