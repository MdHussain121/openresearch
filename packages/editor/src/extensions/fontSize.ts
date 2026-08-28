import { Extension, Mark, mergeAttributes } from '@tiptap/core';

export interface FontSizeOptions {
  types: string[];
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    textStyle: {
      removeEmptyTextStyle: () => ReturnType;
    };
  }
}

export const TextStyle = Mark.create({
  name: 'textStyle',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const hasStyle = el.hasAttribute('style');
          const hasFontSize = el.hasAttribute('data-font-size');
          if (!hasStyle && !hasFontSize) {
            return false;
          }
          return {};
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      removeEmptyTextStyle:
        () =>
        ({ commands }) => {
          const attributes = this.editor.getAttributes(this.name);
          const hasAttributes = Object.values(attributes).some((value) => Boolean(value));
          if (!hasAttributes) {
            return commands.unsetMark(this.name);
          }
          return true;
        },
    };
  },
});

export const FontSize = Extension.create<FontSizeOptions>({
  name: 'fontSize',

  addOptions() {
    return {
      types: ['textStyle'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) =>
              (element as HTMLElement).style.fontSize?.replace(/['"]+/g, '') ||
              (element as HTMLElement).getAttribute('data-font-size') ||
              null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }
              return {
                style: `font-size: ${attributes.fontSize}`,
                'data-font-size': attributes.fontSize,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize: string) =>
        ({ chain }) => {
          return chain()
            .setMark('textStyle', { fontSize })
            .run();
        },
      unsetFontSize:
        () =>
        ({ chain }) => {
          return chain()
            .unsetMark('textStyle')
            .run();
        },
    };
  },
});
