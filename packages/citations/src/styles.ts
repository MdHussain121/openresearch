/**
 * Citation Style Formatter Engine
 * Implements 26 major academic citation styles:
 * APA 7, MLA 9, Chicago 17th (Author-Date + Notes), IEEE, Harvard, Vancouver,
 * Nature, Science, ACM, ACS, Turabian, AMA, NLM, CSE, APSA, ASA, AAA,
 * MHRA, Oxford, OSCOLA, Bluebook, ABNT, ISO 690, GB/T 7714, and Cell Press.
 */

import { Author, BibliographicReference, CitationStyle, FormattedCitation } from './types';

/**
 * Format author names for inline citations according to style rules.
 */
export function formatInlineAuthors(authors: Author[], style: CitationStyle): string {
  if (!authors || authors.length === 0) {
    return 'Unknown';
  }

  const getFamily = (a: Author) => a.familyName || a.literal || 'Unknown';

  if (authors.length === 1 && authors[0]) {
    return getFamily(authors[0]);
  }

  if (authors.length === 2 && authors[0] && authors[1]) {
    const a1 = getFamily(authors[0]);
    const a2 = getFamily(authors[1]);
      switch (style) {
        case 'apa':
        case 'harvard':
          return `${a1} & ${a2}`;
        case 'mla':
        case 'chicago':
        case 'apsa':
        case 'asa':
        case 'aaa':
        case 'cse':
        case 'iso690':
          return `${a1} and ${a2}`;
        default:
          return `${a1} & ${a2}`;
      }
  }

  // 3 or more authors
  const first = authors[0] ? getFamily(authors[0]) : 'Unknown';
  return `${first} et al.`;
}

/**
 * Format an inline marker for in-text citation.
 * e.g., (Vaswani et al., 2017) or [1]
 */
export function formatInlineCitation(
  ref: BibliographicReference,
  style: CitationStyle,
  index = 1,
  pageNumber?: number
): string {
  const authorStr = formatInlineAuthors(ref.authors, style);
  const yearStr = ref.year ? String(ref.year) : 'n.d.';
  const pageStr = pageNumber ? `: ${pageNumber}` : '';

  switch (style) {
    case 'apa':
      return `(${authorStr}, ${yearStr}${pageStr})`;

    case 'mla': {
      const mlaPage = pageNumber ? ` ${pageNumber}` : '';
      return `(${authorStr}${mlaPage})`;
    }

    case 'chicago':
      return `(${authorStr} ${yearStr}${pageStr})`;

    case 'harvard':
      return `(${authorStr}, ${yearStr}${pageStr})`;

    case 'ieee':
    case 'acm':
      return `[${index}]`;

    case 'vancouver':
    case 'science':
      return `(${index})`;

    case 'nature':
    case 'chicago-notes':
      return `${index}`;

    case 'acs':
      return `[${index}]`;

    case 'turabian':
      return `(${authorStr} ${yearStr}${pageStr})`;

    case 'apsa':
    case 'iso690':
      return `(${authorStr}, ${yearStr}${pageStr})`;

    case 'asa':
    case 'aaa':
      return `(${authorStr} ${yearStr}${pageStr})`;

    case 'ama':
    case 'mhra':
    case 'oxford':
    case 'oscola':
    case 'bluebook':
      return `${index}`;

    case 'cse':
    case 'gbt7714':
      return `[${index}]`;

    case 'nlm':
    case 'cell':
      return `(${index})`;

    case 'abnt': {
      const fams = (ref.authors || []).map(a => (a.familyName || a.literal || 'Unknown').toUpperCase());
      const abntAuthors = fams.length > 2 ? `${fams[0]} et al.` : fams.join('; ');
      return `(${abntAuthors}, ${yearStr}${pageStr})`;
    }

    default:
      return `(${authorStr}, ${yearStr})`;
  }
}

/**
 * Format author list for Bibliography entry according to style.
 */
function formatBibliographyAuthors(authors: Author[], style: CitationStyle): string {
  if (!authors || authors.length === 0) {
    return 'Unknown Author';
  }

  const formatSingle = (a: Author, _inverted = true) => {
    if (a.literal) return a.literal;
    const fam = a.familyName || '';
    const given = (a.givenName || '').trim();
    if (!given) return fam;
    const initial = given.charAt(0).toUpperCase();

    if (style === 'vancouver' || style === 'nlm' || style === 'ama' || style === 'cse') {
      return `${fam} ${initial}`;
    }
    if (style === 'gbt7714') {
      return `${fam.toUpperCase()} ${initial}`;
    }
    if (style === 'ieee') {
      return `${initial}. ${fam}`;
    }
    if (style === 'mhra' || style === 'oxford' || style === 'oscola' || style === 'bluebook') {
      return `${given} ${fam}`;
    }
    if (style === 'abnt') {
      return `${fam.toUpperCase()}, ${initial}.`;
    }
    return `${fam}, ${initial}.`;
  };

  if (authors.length === 1 && authors[0]) {
    return formatSingle(authors[0], true);
  }

  if (style === 'vancouver' || style === 'nlm') {
    if (authors.length <= 6) {
      return authors.map(a => formatSingle(a, true)).join(', ');
    }
    return authors.slice(0, 6).map(a => formatSingle(a, true)).join(', ') + ', et al.';
  }

  if (style === 'ama') {
    if (authors.length <= 6) {
      return authors.map(a => formatSingle(a, true)).join(', ');
    }
    return authors[0] ? `${formatSingle(authors[0], true)}, et al.` : 'Unknown Author';
  }

  if (style === 'cse') {
    if (authors.length <= 10) {
      return authors.map(a => formatSingle(a, true)).join(', ');
    }
    return authors[0] ? `${formatSingle(authors[0], true)}, et al.` : 'Unknown Author';
  }

  if (style === 'gbt7714') {
    if (authors.length <= 3) {
      return authors.map(a => formatSingle(a, true)).join(', ');
    }
    return authors.slice(0, 3).map(a => formatSingle(a, true)).join(', ') + ', et al.';
  }

  if (style === 'abnt') {
    if (authors.length <= 3) {
      return authors.map(a => formatSingle(a, true)).join('; ');
    }
    return authors[0] ? `${formatSingle(authors[0], true)} et al.` : 'Unknown Author';
  }

  if (style === 'mhra' || style === 'oxford' || style === 'oscola' || style === 'bluebook') {
    if (authors.length === 2 && authors[0] && authors[1]) {
      return `${formatSingle(authors[0], false)} and ${formatSingle(authors[1], false)}`;
    }
    return authors[0] ? `${formatSingle(authors[0], false)} et al.` : 'Unknown Author';
  }

  if (style === 'asa') {
    if (authors.length === 2 && authors[0] && authors[1]) {
      const second = `${authors[1].givenName || ''} ${authors[1].familyName}`.trim();
      return `${formatSingle(authors[0], true)}, and ${second}`;
    }
    return authors[0] ? `${formatSingle(authors[0], true)}, et al.` : 'Unknown Author';
  }

  if (style === 'ieee') {
    if (authors.length <= 6) {
      return authors.map(a => formatSingle(a, false)).join(', ');
    }
    return authors[0] ? `${formatSingle(authors[0], false)} et al.` : 'Unknown Author';
  }

  if (style === 'apa' || style === 'cell') {
    if (authors.length === 2 && authors[0] && authors[1]) {
      return `${formatSingle(authors[0], true)}, & ${formatSingle(authors[1], true)}`;
    }
    if (authors.length <= 20) {
      const last = authors[authors.length - 1];
      const allExceptLast = authors.slice(0, -1).map(a => formatSingle(a, true)).join(', ');
      return last ? `${allExceptLast}, & ${formatSingle(last, true)}` : allExceptLast;
    }
    const last = authors[authors.length - 1];
    const first19 = authors.slice(0, 19).map(a => formatSingle(a, true)).join(', ');
    return last ? `${first19}, ... ${formatSingle(last, true)}` : first19;
  }

  if (style === 'mla') {
    if (authors.length === 2 && authors[0] && authors[1]) {
      return `${formatSingle(authors[0], true)}, and ${authors[1].givenName || ''} ${authors[1].familyName}`.trim();
    }
    return authors[0] ? `${formatSingle(authors[0], true)}, et al.` : 'Unknown Author';
  }

  if (style === 'chicago' || style === 'apsa' || style === 'aaa') {
    if (authors.length === 2 && authors[0] && authors[1]) {
      return `${formatSingle(authors[0], true)}, and ${authors[1].givenName || ''} ${authors[1].familyName}`.trim();
    }
    if (authors.length <= 3 && authors[0] && authors[1] && authors[2]) {
      return `${formatSingle(authors[0], true)}, ${authors[1].givenName || ''} ${authors[1].familyName}, and ${authors[2].givenName || ''} ${authors[2].familyName}`.trim();
    }
    return authors[0] ? `${formatSingle(authors[0], true)}, et al.` : 'Unknown Author';
  }

  // Harvard fallback
  if (authors.length === 2 && authors[0] && authors[1]) {
    return `${formatSingle(authors[0], true)} and ${formatSingle(authors[1], true)}`;
  }
  return authors[0] ? `${formatSingle(authors[0], true)} et al.` : 'Unknown Author';
}

/**
 * Format full bibliography reference according to citation style.
 */
export function formatBibliographyEntry(
  ref: BibliographicReference,
  style: CitationStyle,
  index = 1
): string {
  const authors = formatBibliographyAuthors(ref.authors, style);
  const year = ref.year ? String(ref.year) : 'n.d.';
  const title = ref.title.trim().replace(/\.$/, '');
  const venue = ref.journal || ref.booktitle || ref.publisher || '';
  const volume = ref.volume ? `vol. ${ref.volume}` : '';
  const issue = ref.issue ? `no. ${ref.issue}` : '';
  const pages = ref.pages ? `pp. ${ref.pages}` : '';
  const doi = ref.doi ? `https://doi.org/${ref.doi.replace(/^https?:\/\/doi\.org\//, '')}` : '';

  switch (style) {
    case 'apa': {
      // Author, A. A. (Year). Title of paper. Journal/Venue, vol(issue), pages. DOI
      const volIssue = [ref.volume, ref.issue ? `(${ref.issue})` : ''].filter(Boolean).join('');
      const locDetails = [venue, volIssue, ref.pages].filter(Boolean).join(', ');
      const doiPart = doi ? ` ${doi}` : '';
      return `${authors} (${year}). ${title}.${locDetails ? ` ${locDetails}.` : ''}${doiPart}`.trim();
    }

    case 'mla': {
      // Author. "Title." Venue, vol. X, no. Y, Year, pp. Z. DOI.
      const parts: string[] = [];
      if (venue) parts.push(venue);
      if (volume) parts.push(volume);
      if (issue) parts.push(issue);
      if (ref.year) parts.push(String(ref.year));
      if (pages) parts.push(pages);
      const container = parts.join(', ');
      const doiPart = doi ? ` ${doi}.` : '';
      return `${authors}. "${title}." ${container ? `${container}.` : ''}${doiPart}`.trim();
    }

    case 'chicago':
    case 'apsa':
    case 'aaa': {
      // Author. Year. "Title." Venue vol (issue): pages. DOI.
      const volIssue = [ref.volume, ref.issue ? `(${ref.issue})` : ''].filter(Boolean).join('');
      const loc = [venue, volIssue, ref.pages].filter(Boolean).join(': ');
      const doiPart = doi ? ` ${doi}` : '';
      return `${authors}. ${year}. "${title}."${loc ? ` ${loc}.` : ''}${doiPart}`.trim();
    }

    case 'ieee': {
      // [1] A. Author, "Title," Venue, vol. X, no. Y, pp. Z, Year.
      const parts: string[] = [];
      if (venue) parts.push(venue);
      if (volume) parts.push(volume);
      if (issue) parts.push(issue);
      if (pages) parts.push(pages);
      if (ref.year) parts.push(String(ref.year));
      const body = parts.join(', ');
      return `[${index}] ${authors}, "${title},"${body ? ` ${body}.` : ''}`.trim();
    }

    case 'harvard': {
      // Author, A. (Year) 'Title', Venue, vol(issue), pp. pages.
      const volIssue = [ref.volume, ref.issue ? `(${ref.issue})` : ''].filter(Boolean).join('');
      const parts = [venue, volIssue, pages].filter(Boolean).join(', ');
      return `${authors} (${year}) '${title}', ${parts ? `${parts}.` : ''}`.trim();
    }

    case 'vancouver':
    case 'nlm': {
      // (1) Author AA. Title. Venue. Year;vol(issue):pages.
      const volIssue = [ref.volume, ref.issue ? `(${ref.issue})` : ''].filter(Boolean).join('');
      const dateVol = [ref.year ? String(ref.year) : '', volIssue].filter(Boolean).join(';');
      const loc = [dateVol, ref.pages].filter(Boolean).join(':');
      const venuePart = [venue, loc].filter(Boolean).join('. ');
      return `(${index}) ${authors}. ${title}.${venuePart ? ` ${venuePart}.` : ''}`.trim();
    }

    case 'ama':
    case 'cse': {
      // [1] Author AA, Author BB. Title. Venue. Year;vol(issue):pages. doi: ...
      const volIssue = [ref.volume, ref.issue ? `(${ref.issue})` : ''].filter(Boolean).join('');
      const dateVol = [ref.year ? String(ref.year) : '', volIssue].filter(Boolean).join(';');
      const loc = [dateVol, ref.pages].filter(Boolean).join(':');
      const venuePart = [venue, loc].filter(Boolean).join('. ');
      const doiPart = doi ? ` doi: ${doi}.` : '';
      return `[${index}] ${authors}. ${title}.${venuePart ? ` ${venuePart}.` : ''}${doiPart}`.trim();
    }

    case 'nature':
    case 'cell': {
      // 1. Author, A. Title. Venue vol, pages (Year).
      const volPages = [ref.volume, ref.pages].filter(Boolean).join(', ');
      const venueVol = [venue, volPages].filter(Boolean).join(' ');
      const datePart = ref.year ? ` (${ref.year})` : '';
      const doiPart = doi ? ` ${doi}` : '';
      return `${index}. ${authors}. ${title}. ${venueVol}${datePart}.${doiPart}`.trim();
    }

    case 'science': {
      // 1. A. Author, Title. Venue vol, pages (Year).
      const volPages = [ref.volume, ref.pages].filter(Boolean).join(', ');
      const loc = [venue, volPages].filter(Boolean).join(' ');
      const datePart = ref.year ? ` (${ref.year})` : '';
      return `(${index}) ${authors}, ${title}. ${loc}${datePart}.`.trim();
    }

    case 'acm': {
      // [1] Author. Year. Title. Venue vol, issue (Year), pages. DOI.
      const volIssue = [ref.volume ? `vol. ${ref.volume}` : '', ref.issue ? `no. ${ref.issue}` : ''].filter(Boolean).join(', ');
      const parts = [venue, volIssue, pages].filter(Boolean).join(', ');
      const doiPart = doi ? ` ${doi}.` : '';
      return `[${index}] ${authors}. ${year}. ${title}.${parts ? ` ${parts}.` : ''}${doiPart}`.trim();
    }

    case 'acs': {
      // (1) Author. Title. Venue Year, vol, pages.
      const yearVolPages = [ref.year ? String(ref.year) : '', ref.volume, ref.pages].filter(Boolean).join(', ');
      const loc = [venue, yearVolPages].filter(Boolean).join(' ');
      const doiPart = doi ? ` ${doi}.` : '';
      return `(${index}) ${authors}. ${title}. ${loc}.${doiPart}`.trim();
    }

    case 'chicago-notes': {
      // 1. Author, "Title," Venue vol, no. issue (Year): pages.
      const volIssue = [ref.volume, ref.issue ? `no. ${ref.issue}` : ''].filter(Boolean).join(', ');
      const loc = [venue, volIssue].filter(Boolean).join(' ');
      const datePages = [ref.year ? `(${ref.year})` : '', ref.pages].filter(Boolean).join(': ');
      return `${index}. ${authors}, "${title},"${loc ? ` ${loc}` : ''}${datePages ? ` ${datePages}.` : '.'}`.trim();
    }

    case 'turabian': {
      // Author. Year. "Title." Venue vol (issue): pages.
      const volIssue = [ref.volume, ref.issue ? `(${ref.issue})` : ''].filter(Boolean).join('');
      const loc = [venue, volIssue, ref.pages].filter(Boolean).join(': ');
      return `${authors}. ${year}. "${title}."${loc ? ` ${loc}.` : ''}`.trim();
    }

    case 'asa': {
      // Author, A., et al. Year. "Title." Venue vol: pages.
      const asaLoc = [venue, [ref.volume, ref.pages].filter(Boolean).join(': ')].filter(Boolean).join(' ');
      return `${authors} ${year}. "${title}."${asaLoc ? ` ${asaLoc}.` : ''}`.trim();
    }

    case 'mhra': {
      // Author and Author, 'Title', Venue, vol X, no. Y (Year), pp. Z.
      const mhraParts = [
        venue,
        ref.volume ? `vol ${ref.volume}` : '',
        ref.issue ? `no. ${ref.issue}` : '',
      ].filter(Boolean).join(', ');
      const datePages = [ref.year ? `(${ref.year})` : '', ref.pages].filter(Boolean).join(', ');
      return `${authors}, '${title}',${mhraParts ? ` ${mhraParts},` : ''}${datePages ? ` ${datePages}.` : '.'}`.trim();
    }

    case 'oxford': {
      // 1. Author, Title, Venue (Year).
      const oxfordLoc = [venue].filter(Boolean).join(', ');
      return `${index}. ${authors}, ${title}${oxfordLoc ? `, ${oxfordLoc}` : ''} (${year}).`.trim();
    }

    case 'oscola': {
      // Author, 'Title' (Year) vol Journal pages.
      const oscolaLoc = [ref.volume || '', venue, ref.pages || ''].filter(Boolean).join(' ');
      const yearPart = ref.year ? ` (${ref.year})` : '';
      return `${authors}, '${title}'${yearPart}${oscolaLoc ? ` ${oscolaLoc}` : ''}.`.trim();
    }

    case 'bluebook': {
      // Author, Title, vol Journal pages (Year).
      const bluebookLoc = [ref.volume || '', venue, ref.pages || ''].filter(Boolean).join(' ');
      return `${authors}, ${title},${bluebookLoc ? ` ${bluebookLoc},` : ''} (${year}).`.trim();
    }

    case 'abnt': {
      // FAM, N. Title. Venue, vol. X, no. Y, p. Z, Year.
      const abntParts = [
        venue,
        ref.volume ? `v. ${ref.volume}` : '',
        ref.issue ? `n. ${ref.issue}` : '',
        ref.pages ? `p. ${ref.pages}` : '',
        ref.year ? String(ref.year) : '',
      ].filter(Boolean).join(', ');
      const doiPart = doi ? ` ${doi}.` : '';
      return `${authors} ${title}. ${abntParts}.${doiPart}`.trim();
    }

    case 'iso690': {
      // Author, A. Title. Venue. Year, vol. X, no. Y, pp. Z.
      const isoParts = [
        ref.year ? String(ref.year) : '',
        ref.volume ? `vol. ${ref.volume}` : '',
        ref.issue ? `no. ${ref.issue}` : '',
        ref.pages ? `pp. ${ref.pages}` : '',
      ].filter(Boolean).join(', ');
      const doiPart = doi ? ` ${doi}.` : '';
      return `${authors}. ${title}.${venue ? ` ${venue}.` : ''}${isoParts ? ` ${isoParts}.` : ''}${doiPart}`.trim();
    }

    case 'gbt7714': {
      // [1] FAM I, FAM I. Title[J]. Venue, Year, vol(issue): pages.
      const gbtVolIssue = [ref.volume, ref.issue ? `(${ref.issue})` : ''].filter(Boolean).join('');
      const gbtTail = [ref.year ? String(ref.year) : '', gbtVolIssue].filter(Boolean).join(', ');
      const gbtPages = ref.pages ? `: ${ref.pages}` : '';
      const venuePart = [venue, gbtTail].filter(Boolean).join(', ');
      return `[${index}] ${authors}. ${title}[J].${venuePart ? ` ${venuePart}${gbtPages}.` : '.'}`.trim();
    }

    default:
      return `${authors} (${year}). ${title}. ${venue}`.trim();
  }
}

/**
 * Generate full formatted bibliography list with inline markers and entries.
 */
export function generateBibliography(
  references: BibliographicReference[],
  style: CitationStyle
): FormattedCitation[] {
  return references.map((ref, i) => {
    const index = i + 1;
    return {
      referenceId: ref.id,
      inlineMarker: formatInlineCitation(ref, style, index),
      bibliographyEntry: formatBibliographyEntry(ref, style, index),
      style,
      index,
      reference: ref,
    };
  });
}

/**
 * Parse Zotero JSON export (CSL-JSON or Zotero API item format) into BibliographicReference list
 */
export function parseZoteroJson(input: string | any[]): BibliographicReference[] {
  try {
    const items = typeof input === 'string' ? JSON.parse(input) : input;
    const rawList = Array.isArray(items) ? items : [items];

    return rawList.map((item: any, idx: number): BibliographicReference => {
      const data = item.data || item; // Support both Zotero API wrapped item and raw CSL-JSON
      // Identifier precedence: Zotero API key -> data.key -> data.id -> generated.
      // Written as an if-chain so each arm is individually attributable in coverage.
      let id: string;
      if (item.key) {
        id = item.key;
      } else if (data.key) {
        id = data.key;
      } else if (data.id) {
        id = data.id;
      } else {
        id = `zotero-${idx + 1}-${Date.now()}`;
      }
      const title = data.title || data.name || 'Untitled Document';
      
      const authors: Author[] = [];
      if (Array.isArray(data.creators)) {
        data.creators.forEach((c: any) => {
          if (c.lastName || c.familyName) {
            authors.push({
              familyName: c.lastName || c.familyName,
              givenName: c.firstName || c.givenName,
            });
          } else if (c.name || c.literal) {
            authors.push({
              familyName: c.name || c.literal,
              literal: c.name || c.literal,
            });
          }
        });
      } else if (Array.isArray(data.author)) {
        data.author.forEach((a: any) => {
          authors.push({
            familyName: a.family || a.lastName || a.name || 'Unknown',
            givenName: a.given || a.firstName,
            literal: a.literal,
          });
        });
      }

      if (authors.length === 0) {
        authors.push({ familyName: 'Unknown' });
      }

      let year: number | undefined;
      const dateStr = data.date || data.issued?.['date-parts']?.[0]?.[0] || data.year;
      if (dateStr) {
        const match = String(dateStr).match(/\b(19|20)\d{2}\b/);
        if (match) {
          year = parseInt(match[0], 10);
        }
      }

      const doi = data.DOI || data.doi;
      const url = data.url || data.URL;
      const journal = data.publicationTitle || data.journalAbbreviation || data['container-title'];

      return {
        id,
        paperId: id,
        title,
        authors,
        year,
        doi,
        url,
        journal,
        volume: data.volume ? String(data.volume) : undefined,
        issue: data.issue ? String(data.issue) : undefined,
        pages: data.pages || data.page,
        publisher: data.publisher,
        abstract: data.abstractNote || data.abstract,
        extractionStatus: 'ok',
      };
    });
  } catch (err) {
    return [];
  }
}

