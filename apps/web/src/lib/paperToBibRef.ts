import { Paper } from '../context/PaperContext';
import { BibliographicReference } from '@openresearch/citations';

export const paperToBibRef = (p: Paper): BibliographicReference => ({
  id: p.id,
  title: p.title || 'Untitled',
  authors: p.authors || [{ familyName: 'Unknown' }],
  year: p.year,
  doi: p.doi,
  journal: p.metadata_json?.journal,
  publisher: p.metadata_json?.publisher,
  abstract: p.abstract,
  extractionStatus: p.extraction_status,
});
