/**
 * Citation domain types
 */

export type CitationStyle = 
  | 'apa' 
  | 'mla' 
  | 'chicago' 
  | 'ieee' 
  | 'harvard' 
  | 'vancouver'
  | 'nature'
  | 'science'
  | 'acm'
  | 'acs'
  | 'chicago-notes'
  | 'turabian'
  | 'ama'
  | 'nlm'
  | 'cse'
  | 'apsa'
  | 'asa'
  | 'aaa'
  | 'mhra'
  | 'oxford'
  | 'oscola'
  | 'bluebook'
  | 'abnt'
  | 'iso690'
  | 'gbt7714'
  | 'cell';

export type AttributionScope = 'sentence' | 'clause';

export type ExtractionStatus = 'ok' | 'unverified' | 'unresolved';

export type EntryType = 
  | 'article' 
  | 'inproceedings' 
  | 'conference' 
  | 'book' 
  | 'incollection' 
  | 'phdthesis' 
  | 'mastersthesis' 
  | 'techreport' 
  | 'misc'
  | 'unpublished';

export interface Author {
  givenName?: string;
  familyName: string;
  literal?: string;
}

export interface BibliographicReference {
  id: string;
  paperId?: string;
  citationKey?: string;
  entryType?: EntryType;
  title: string;
  authors: Author[];
  year?: number;
  doi?: string;
  arxivId?: string;
  pmid?: string;
  journal?: string;
  booktitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  abstract?: string;
  url?: string;
  bibtex?: string;
  extractionStatus: ExtractionStatus;
}

export interface CitationItem {
  id: string;
  documentId: string;
  paperId: string;
  position: number;
  citationStyle: CitationStyle;
  attributionScope: AttributionScope;
  pageNumber?: number;
  relevantPassage?: string;
}

export interface FormattedCitation {
  referenceId: string;
  inlineMarker: string; // e.g. "(Vaswani et al., 2017)" or "[1]"
  bibliographyEntry: string;
  style: CitationStyle;
  index: number;
  reference: BibliographicReference;
}

export interface BibtexEntry {
  type: string;
  citationKey: string;
  fields: Record<string, string>;
}

export interface BibtexParseResult {
  entries: BibliographicReference[];
  errors: string[];
  totalParsed: number;
}
