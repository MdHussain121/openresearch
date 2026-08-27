import { Node, mergeAttributes } from '@tiptap/core';
import { BibliographicReference, CitationStyle, formatInlineCitation } from '@openresearch/citations';

export interface CitationNodeOptions {
  HTMLAttributes: Record<string, any>;
  onInspectCitation?: (paperId: string, pageNumber?: number, relevantPassage?: string) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: {
        paperId: string;
        paperTitle: string;
        authors?: string;
        year?: number;
        citationStyle?: CitationStyle;
        index?: number;
        attributionScope?: 'sentence' | 'clause';
        pageNumber?: number;
        relevantPassage?: string;
      }) => ReturnType;
    };
  }
}

// Attribute parsers/renderers are declared once at module scope so every
// editor instance shares them (and coverage attribution stays deterministic).
const citationAttributes = {
  paperId: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-paper-id') || '',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-paper-id': attrs.paperId }),
  },
  paperTitle: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-paper-title') || '',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-paper-title': attrs.paperTitle }),
  },
  authors: {
    default: 'Unknown Author',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-authors') || 'Unknown Author',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-authors': attrs.authors }),
  },
  year: {
    default: null as number | null,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute('data-year');
      return v ? parseInt(v, 10) : null;
    },
    renderHTML: (attrs: { year?: number | null }) =>
      attrs.year ? { 'data-year': String(attrs.year) } : {},
  },
  citationStyle: {
    default: 'apa',
    parseHTML: (el: HTMLElement) => (el.getAttribute('data-citation-style') as CitationStyle) || 'apa',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-citation-style': attrs.citationStyle }),
  },
  index: {
    default: 1,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute('data-index');
      return v ? parseInt(v, 10) : 1;
    },
    renderHTML: (attrs: { index?: number }) => ({ 'data-index': String(attrs.index ?? 1) }),
  },
  attributionScope: {
    default: 'sentence' as 'sentence' | 'clause',
    parseHTML: (el: HTMLElement) =>
      (el.getAttribute('data-attribution-scope') as 'sentence' | 'clause') || 'sentence',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-attribution-scope': attrs.attributionScope }),
  },
  pageNumber: {
    default: null as number | null,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute('data-page-number');
      return v ? parseInt(v, 10) : null;
    },
    renderHTML: (attrs: { pageNumber?: number | null }) =>
      attrs.pageNumber ? { 'data-page-number': String(attrs.pageNumber) } : {},
  },
  relevantPassage: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-relevant-passage') || null,
    renderHTML: (attrs: { relevantPassage?: string | null }) =>
      attrs.relevantPassage ? { 'data-relevant-passage': attrs.relevantPassage } : {},
  },
};

export const CitationNode = Node.create<CitationNodeOptions>({
  name: 'citation',
  group: 'inline',
  inline: true,
  selectable: true,
  draggable: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return citationAttributes;
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-citation-node]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const style: CitationStyle = (node.attrs.citationStyle as CitationStyle) || 'apa';
    const index = node.attrs.index || 1;
    const authorStr = node.attrs.authors || 'Unknown';
    const firstAuthor = authorStr.split(',')[0].trim().split(' ')[0] || 'Author';

    const mockRef: BibliographicReference = {
      id: node.attrs.paperId,
      title: node.attrs.paperTitle,
      authors: [{ familyName: firstAuthor }],
      year: node.attrs.year || undefined,
      extractionStatus: 'ok',
    };

    const displayText = formatInlineCitation(mockRef, style, index, node.attrs.pageNumber);

    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-citation-node': 'true',
        'data-paper-id': node.attrs.paperId,
        'data-paper-title': node.attrs.paperTitle,
        'data-authors': node.attrs.authors,
        'data-year': node.attrs.year,
        'data-index': node.attrs.index,
        'data-citation-style': style,
        class:
          'citation-pill inline-flex items-center px-1.5 py-0.2 mx-0.5 rounded text-[12px] font-sans font-medium bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 cursor-pointer select-none transition-[transform,background-color,box-shadow,border-color] duration-150 hover:shadow-2xs active:scale-[0.95] align-baseline',
        title: `Citation: ${node.attrs.paperTitle} (${node.attrs.authors || 'Unknown'}, ${node.attrs.year || 'n.d.'}) — Click to inspect`,
      }),
      displayText,
    ];
  },

  addCommands() {
    return {
      insertCitation:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    };
  },
});
