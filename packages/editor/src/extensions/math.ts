import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';

export interface MathOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      setMathEquation: (latex: string) => ReturnType;
    };
  }
}

export const MathEquation = Node.create<MathOptions>({
  name: 'mathEquation',
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
    return {
      latex: {
        default: 'E = mc^2',
        parseHTML: (element) => element.getAttribute('data-latex') || element.textContent || '',
        renderHTML: (attributes) => ({
          'data-latex': attributes.latex,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-latex]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    let renderedHtml = '';
    try {
      renderedHtml = katex.renderToString(node.attrs.latex || '', {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      renderedHtml = node.attrs.latex || '';
    }

    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'math-node inline-block px-1.5 py-0.5 mx-0.5 rounded bg-sunken border border-border-default font-mono text-sm cursor-pointer select-all hover:border-accent transition-colors',
        'data-latex': node.attrs.latex,
        title: `LaTeX: ${node.attrs.latex}`,
      }),
      ['span', { class: 'math-render pointer-events-none', innerHTML: renderedHtml }],
    ];
  },

  addCommands() {
    return {
      setMathEquation:
        (latex: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { latex },
          });
        },
    };
  },
});
