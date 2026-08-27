import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { GroundedPassage, GroundingState } from '@openresearch/ai';

export interface GhostTextState {
  active: boolean;
  text: string;
  pos: number | null;
  groundingState: GroundingState;
  sources: GroundedPassage[];
}

export const ghostTextPluginKey = new PluginKey<GhostTextState>('ghostText');

export interface GhostTextOptions {
  onInspectSource?: (paperId: string, pageNumber?: number, passage?: string) => void;
  onAccept?: (text: string, groundingState: GroundingState, sources: GroundedPassage[]) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ghostText: {
      setGhostText: (data: {
        text: string;
        groundingState?: GroundingState;
        sources?: GroundedPassage[];
      }) => ReturnType;
      clearGhostText: () => ReturnType;
      acceptGhostText: () => ReturnType;
    };
  }
}

/**
 * Builds the ghost-text preview DOM (span + optional grounding badge).
 * Extracted as an exported factory so the rendering logic is unit-testable.
 */
export function createGhostTextSpan(
  text: string,
  groundingState: GroundingState,
  sources: GroundedPassage[],
  onInspectSource?: GhostTextOptions['onInspectSource']
): HTMLSpanElement {
const span = document.createElement('span');
  span.className =
    'ghost-text-preview font-serif text-[17px] text-text-tertiary select-none italic opacity-75 inline';
  span.style.transitionTimingFunction = 'var(--ease-default)';
  span.setAttribute('data-ghost-text', 'true');
  span.textContent = text;

  if (groundingState === 'source-grounded' && sources && sources.length > 0) {
    const topSource = sources[0];
    if (topSource) {
      const badge = document.createElement('span');
      badge.className =
        'source-preview-badge ml-1.5 px-1.5 py-0.5 rounded text-[11px] bg-accent/15 text-accent border border-accent/30 font-sans not-italic font-medium cursor-pointer hover:bg-accent/25 transition-colors duration-150 select-none inline-flex items-center gap-1';
      const svgIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgIcon.setAttribute('class', 'w-3 h-3 text-accent shrink-0');
      svgIcon.setAttribute('viewBox', '0 0 24 24');
      svgIcon.setAttribute('fill', 'none');
      svgIcon.setAttribute('stroke', 'currentColor');
      svgIcon.setAttribute('stroke-width', '2');
      svgIcon.setAttribute('stroke-linecap', 'round');
      svgIcon.setAttribute('stroke-linejoin', 'round');
      const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path1.setAttribute('d', 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z');
      const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path2.setAttribute('d', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z');
      svgIcon.appendChild(path1);
      svgIcon.appendChild(path2);
      const label = document.createElement('span');
      label.textContent = topSource.authors || 'Source';
      badge.appendChild(svgIcon);
      badge.appendChild(label);
      badge.title = `Grounded Preview: ${topSource.paperTitle || 'Paper'} (Click to preview source in panel)`;
      badge.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (onInspectSource && topSource.paperId) {
          onInspectSource(topSource.paperId, topSource.pageNumber, topSource.passageText);
        }
      };
      span.appendChild(badge);
    }
  }

  return span;
}

export const GhostText = Extension.create<GhostTextOptions>({
  name: 'ghostText',

  addOptions() {
    return {
      onInspectSource: undefined,
      onAccept: undefined,
    };
  },
  addCommands() {
    return {
      setGhostText:
        (data) =>
        ({ tr, dispatch, state }) => {
          if (dispatch) {
            const pos = state.selection.from;
            tr.setMeta(ghostTextPluginKey, {
              active: true,
              text: data.text,
              pos,
              groundingState: data.groundingState || 'general-knowledge',
              sources: data.sources || [],
            });
          }
          return true;
        },

      clearGhostText:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(ghostTextPluginKey, {
              active: false,
              text: '',
              pos: null,
              groundingState: 'general-knowledge',
              sources: [],
            });
          }
          return true;
        },

      acceptGhostText:
        () =>
        ({ tr, dispatch, state, editor }) => {
          const pluginState = ghostTextPluginKey.getState(state);
          if (!pluginState || !pluginState.active || !pluginState.text || pluginState.pos === null) {
            return false;
          }

          if (dispatch) {
            const { text, pos, groundingState, sources } = pluginState;
            tr.insertText(text, pos);

            // Clear ghost text state
            tr.setMeta(ghostTextPluginKey, {
              active: false,
              text: '',
              pos: null,
              groundingState: 'general-knowledge',
              sources: [],
            });

            this.options.onAccept?.(text, groundingState, sources);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const state = editor.state;
        const pluginState = ghostTextPluginKey.getState(state);
        if (pluginState && pluginState.active && pluginState.text) {
          return editor.commands.acceptGhostText();
        }
        return false;
      },
      Escape: ({ editor }) => {
        const state = editor.state;
        const pluginState = ghostTextPluginKey.getState(state);
        if (pluginState && pluginState.active) {
          return editor.commands.clearGhostText();
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const onInspectSource = this.options.onInspectSource;

    return [
      new Plugin<GhostTextState>({
        key: ghostTextPluginKey,
        state: {
          init() {
            return {
              active: false,
              text: '',
              pos: null,
              groundingState: 'general-knowledge',
              sources: [],
            };
          },
          apply(tr, prevState) {
            const meta = tr.getMeta(ghostTextPluginKey);
            if (meta) {
              return meta as GhostTextState;
            }
            // If document changed, clear ghost text
            if (tr.docChanged && prevState.active) {
              return {
                active: false,
                text: '',
                pos: null,
                groundingState: 'general-knowledge',
                sources: [],
              };
            }
            return prevState;
          },
        },
        props: {
          decorations(state) {
            const pluginState = ghostTextPluginKey.getState(state);
            if (!pluginState || !pluginState.active || !pluginState.text || pluginState.pos === null) {
              return DecorationSet.empty;
            }

            const { text, pos, groundingState, sources } = pluginState;
            if (pos > state.doc.content.size) {
              return DecorationSet.empty;
            }

            const widget = Decoration.widget(pos, () =>
              createGhostTextSpan(text, groundingState, sources, onInspectSource)
            );

            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },
});
