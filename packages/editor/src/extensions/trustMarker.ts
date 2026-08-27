import { Node, mergeAttributes } from '@tiptap/core';

export interface TrustMarkerOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    trustMarker: {
      insertTrustMarker: (attrs: {
        markerType: 'source-grounded' | 'ai-inference';
        index?: number;
        paperId?: string;
        paperTitle?: string;
        pageNumber?: number;
        passageText?: string;
      }) => ReturnType;
    };
  }
}

export const TrustMarker = Node.create<TrustMarkerOptions>({
  name: 'trustMarker',
  group: 'inline',
  inline: true,
  selectable: true,
  draggable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      markerType: {
        default: 'source-grounded',
        parseHTML: (el) => el.getAttribute('data-trust-type') || 'source-grounded',
        renderHTML: (attrs) => ({ 'data-trust-type': attrs.markerType }),
      },
      index: {
        default: 1,
        parseHTML: (el) => {
          const v = el.getAttribute('data-trust-index');
          return v ? parseInt(v, 10) : 1;
        },
        renderHTML: (attrs) => ({ 'data-trust-index': String(attrs.index) }),
      },
      paperId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-paper-id') || null,
        renderHTML: (attrs) => (attrs.paperId ? { 'data-paper-id': attrs.paperId } : {}),
      },
      paperTitle: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-paper-title') || null,
        renderHTML: (attrs) => (attrs.paperTitle ? { 'data-paper-title': attrs.paperTitle } : {}),
      },
      pageNumber: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-page-number');
          return v ? parseInt(v, 10) : null;
        },
        renderHTML: (attrs) => (attrs.pageNumber ? { 'data-page-number': String(attrs.pageNumber) } : {}),
      },
      passageText: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-passage-text') || null,
        renderHTML: (attrs) => (attrs.passageText ? { 'data-passage-text': attrs.passageText } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-trust-marker]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const isGrounded = node.attrs.markerType === 'source-grounded';
    const superscriptDigits = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
    const idx = node.attrs.index || 1;
    const numSuperscript = String(idx)
      .split('')
      .map((d) => superscriptDigits[parseInt(d, 10)] || d)
      .join('');

    const markerText = isGrounded ? numSuperscript : '∿';
    const titleText = isGrounded
      ? `Source Grounded [${idx}]: ${node.attrs.paperTitle || 'Retrieved paper'} (P.${node.attrs.pageNumber || 1})`
      : 'AI inference: Synthesis not directly stated in a single source';

    const colorClass = isGrounded
      ? 'text-trust-grounded hover:bg-trust-grounded/20 border-b border-trust-grounded font-bold'
      : 'text-trust-inference hover:bg-trust-inference/20 border-b border-dashed border-trust-inference font-bold';

    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-trust-marker': 'true',
        'data-trust-type': node.attrs.markerType,
        'data-trust-index': node.attrs.index,
        'data-paper-id': node.attrs.paperId,
        'data-paper-title': node.attrs.paperTitle,
        'data-page-number': node.attrs.pageNumber,
        'data-passage-text': node.attrs.passageText,
        class: `trust-marker inline-flex items-center px-1 py-0 mx-0.5 rounded text-xs cursor-pointer select-none transition-colors ${colorClass}`,
        title: titleText,
      }),
      markerText,
    ];
  },

  addCommands() {
    return {
      insertTrustMarker:
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
