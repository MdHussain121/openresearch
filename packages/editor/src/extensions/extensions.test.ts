// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import katex from 'katex';
import { Schema } from '@tiptap/pm/model';
import { DecorationSet } from '@tiptap/pm/view';
import { CitationNode } from './citation';
import { MathEquation } from './math';
import { TrustMarker } from './trustMarker';
import { ClaimVerificationMark } from './claimVerification';
import { GhostText, ghostTextPluginKey, GhostTextState, createGhostTextSpan } from './ghostText';

// Runtime string key of the PluginKey (not exposed in public TS types).
const GHOST_PLUGIN_KEY = (ghostTextPluginKey as unknown as { key: string }).key;

interface MockElement {
  getAttribute: (name: string) => string | null;
}

type AttributeSpec = {
  default?: unknown;
  parseHTML?: (el: HTMLElement) => unknown;
};

type ExtensionLike = {
  name: string;
  options: Record<string, unknown>;
  config: Record<string, ((...args: never[]) => unknown) | undefined>;
};

const mockElement = (
  attrs: Record<string, string>,
  textContent?: string
): MockElement & { textContent?: string } => ({
  getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
  ...(textContent !== undefined ? { textContent } : {}),
});

const asHTMLElement = (el: MockElement) => el as unknown as HTMLElement;

// TipTap keeps lifecycle methods in extension.config and binds them against an
// extension-like context (`this.options`, `this.name`, ...) at editor build time.
// We replicate that binding here so the pure logic is testable without a full editor.
function callMethod<R>(extension: ExtensionLike, method: string, ...args: unknown[]): R {
  const fn = extension.config[method];
  if (!fn) {
    throw new Error(`Extension "${extension.name}" has no "${method}" in its config.`);
  }
  return fn.bind({
    name: extension.name,
    options: extension.options,
    storage: {},
    extensions: [],
    parent: undefined,
  })(...(args as never[])) as R;
}

const makeInitialState = (): GhostTextState => ({
  active: false,
  text: '',
  pos: null,
  groundingState: 'general-knowledge',
  sources: [],
});

describe('CitationNode extension', () => {
  const ext = CitationNode as unknown as ExtensionLike;
  // Single shared instance so V8 coverage attributes every invocation consistently
  const attrs = callMethod<Record<string, AttributeSpec>>(ext, 'addAttributes');

  it('declares inline atom node semantics', () => {
    expect(ext.config.name).toBe('citation');
    expect(ext.config.group).toBe('inline');
    expect(ext.config.inline).toBe(true);
    expect(ext.config.atom).toBe(true);
  });

  it('parses attributes from data-* HTML attributes', () => {
    const el = mockElement({
      'data-paper-id': 'p1',
      'data-paper-title': 'Attention Is All You Need',
      'data-authors': 'Vaswani, Ashish',
      'data-year': '2017',
      'data-citation-style': 'ieee',
      'data-index': '4',
      'data-page-number': '12',
    });

    expect(attrs.paperId.parseHTML!(asHTMLElement(el))).toBe('p1');
    expect(attrs.paperTitle.parseHTML!(asHTMLElement(el))).toBe('Attention Is All You Need');
    expect(attrs.year.parseHTML!(asHTMLElement(el))).toBe(2017);
    expect(attrs.citationStyle.parseHTML!(asHTMLElement(el))).toBe('ieee');
    expect(attrs.index.parseHTML!(asHTMLElement(el))).toBe(4);
    expect(attrs.pageNumber.parseHTML!(asHTMLElement(el))).toBe(12);
  });

  it('renders page-annotated APA citations and n.d. fallback years', () => {
    const withPage = callMethod<[string, Record<string, unknown>, string]>(
      ext,
      'renderHTML',
      {
        HTMLAttributes: {},
        node: {
          type: { name: 'citation' },
          attrs: {
            paperId: 'p1',
            paperTitle: 'T',
            authors: 'Vaswani',
            year: null,
            citationStyle: 'apa',
            index: 2,
            pageNumber: 7,
          },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    expect(withPage[2]).toBe('(Vaswani, n.d.: 7)');
  });

  it('falls back to defaults for missing attributes', () => {
    const empty = mockElement({});

    expect(attrs.paperId.default).toBe('');
    expect(attrs.paperId.parseHTML!(asHTMLElement(empty))).toBe('');
    expect(attrs.authors.default).toBe('Unknown Author');
    expect(attrs.authors.parseHTML!(asHTMLElement(empty))).toBe('Unknown Author');
    expect(attrs.year.parseHTML!(asHTMLElement(empty))).toBeNull();
    expect(attrs.citationStyle.parseHTML!(asHTMLElement(empty))).toBe('apa');
    expect(attrs.index.parseHTML!(asHTMLElement(empty))).toBe(1);
    expect(attrs.attributionScope.parseHTML!(asHTMLElement(empty))).toBe('sentence');
  });

  it('renders an APA citation pill with formatted display text', () => {
    const render = callMethod<[string, Record<string, unknown>, string]>(
      ext,
      'renderHTML',
      {
        HTMLAttributes: {},
        node: {
          type: { name: 'citation' },
          attrs: {
            paperId: 'p1',
            paperTitle: 'Attention Is All You Need',
            authors: 'Vaswani, Ashish',
            year: 2017,
            citationStyle: 'apa',
            index: 1,
          },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    expect(render[0]).toBe('span');
    expect(render[1]['data-paper-id']).toBe('p1');
    expect(render[1]['data-citation-style']).toBe('apa');
    expect(render[2]).toBe('(Vaswani, 2017)');
  });

  it('renders numeric markers for numbered styles', () => {
    const render = callMethod<[string, Record<string, unknown>, string]>(
      ext,
      'renderHTML',
      {
        HTMLAttributes: {},
        node: {
          type: { name: 'citation' },
          attrs: {
            paperId: 'p1',
            paperTitle: 'T',
            authors: 'A',
            year: 2020,
            citationStyle: 'ieee',
            index: 3,
          },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    expect(render[2]).toBe('[3]');
  });
});

describe('MathEquation extension', () => {
  const ext = MathEquation as unknown as ExtensionLike;
  const attrs = callMethod<Record<string, AttributeSpec>>(ext, 'addAttributes');

  it('declares inline atom node semantics', () => {
    expect(ext.config.name).toBe('mathEquation');
    expect(ext.config.inline).toBe(true);
    expect(ext.config.atom).toBe(true);
  });

  it('defaults latex to a sample equation and parses data-latex', () => {
    expect(attrs.latex.default).toBe('E = mc^2');

    const el = mockElement({ 'data-latex': '\\int_0^1 x dx' });
    expect(attrs.latex.parseHTML!(asHTMLElement(el))).toBe('\\int_0^1 x dx');

    const empty = mockElement({});
    expect(attrs.latex.parseHTML!(asHTMLElement(empty))).toBe('');
  });

  it('renders KaTeX output with the latex attribute preserved', () => {
    const render = callMethod<[string, Record<string, unknown>, [string, Record<string, unknown>]]>(
      ext,
      'renderHTML',
      {
        HTMLAttributes: {},
        node: { type: { name: 'mathEquation' }, attrs: { latex: 'E = mc^2' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    expect(render[0]).toBe('span');
    expect(render[1]['data-latex']).toBe('E = mc^2');
    expect(render[1].title).toBe('LaTeX: E = mc^2');

    const innerRender = render[2][1];
    expect(innerRender.class).toContain('math-render');
    expect(String(innerRender.innerHTML)).toContain('katex');
  });
});

describe('TrustMarker extension', () => {
  const ext = TrustMarker as unknown as ExtensionLike;
  const attrs = callMethod<Record<string, AttributeSpec>>(ext, 'addAttributes');

  it('declares inline atom node semantics', () => {
    expect(ext.config.name).toBe('trustMarker');
    expect(ext.config.atom).toBe(true);
    expect(ext.config.draggable).toBe(false);
  });

  it('parses trust attributes with defaults', () => {
    const el = mockElement({ 'data-trust-type': 'ai-inference', 'data-trust-index': '7' });

    expect(attrs.markerType.parseHTML!(asHTMLElement(el))).toBe('ai-inference');
    expect(attrs.index.parseHTML!(asHTMLElement(el))).toBe(7);

    const empty = mockElement({});
    expect(attrs.markerType.parseHTML!(asHTMLElement(empty))).toBe('source-grounded');
    expect(attrs.index.parseHTML!(asHTMLElement(empty))).toBe(1);
  });

  it('parses provenance attributes only when present', () => {
    const populated = mockElement({
      'data-paper-id': 'p3',
      'data-paper-title': 'Scaling Laws',
      'data-page-number': '5',
      'data-passage-text': 'accuracy improves with scale',
    });
    const empty = mockElement({});

    expect(attrs.paperId.parseHTML!(asHTMLElement(populated))).toBe('p3');
    expect(attrs.paperTitle.parseHTML!(asHTMLElement(populated))).toBe('Scaling Laws');
    expect(attrs.pageNumber.parseHTML!(asHTMLElement(populated))).toBe(5);
    expect(attrs.passageText.parseHTML!(asHTMLElement(populated))).toBe(
      'accuracy improves with scale'
    );

    expect(attrs.paperId.parseHTML!(asHTMLElement(empty))).toBeNull();
    expect(attrs.paperTitle.parseHTML!(asHTMLElement(empty))).toBeNull();
    expect(attrs.pageNumber.parseHTML!(asHTMLElement(empty))).toBeNull();
    expect(attrs.passageText.parseHTML!(asHTMLElement(empty))).toBeNull();
  });

  it('converts multi-digit indices to superscript glyphs for grounded markers', () => {
    const render = callMethod<[string, Record<string, unknown>, string]>(
      ext,
      'renderHTML',
      {
        HTMLAttributes: {},
        node: {
          type: { name: 'trustMarker' },
          attrs: {
            markerType: 'source-grounded',
            index: 12,
            paperTitle: 'Deep Learning',
            pageNumber: 3,
          },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    expect(render[2]).toBe('¹²');
    expect(render[1].title).toContain('Source Grounded [12]');
    expect(render[1].title).toContain('Deep Learning');
  });

  it('uses inference glyph for ai-inference markers', () => {
    const render = callMethod<[string, Record<string, unknown>, string]>(
      ext,
      'renderHTML',
      {
        HTMLAttributes: {},
        node: {
          type: { name: 'trustMarker' },
          attrs: { markerType: 'ai-inference', index: 2 },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    expect(render[2]).toBe('∿');
    expect(render[1].title).toContain('AI inference');
  });
});

describe('ClaimVerificationMark extension', () => {
  const ext = ClaimVerificationMark as unknown as ExtensionLike;
  const attrs = callMethod<Record<string, AttributeSpec>>(ext, 'addAttributes');

  it('declares mark semantics', () => {
    expect(ext.config.name).toBe('claimVerification');
  });

  it('parses dismissed flag strictly from "true" string', () => {

    const dismissed = mockElement({ 'data-claim-dismissed': 'true' });
    const unsupported = mockElement({ 'data-claim-dismissed': 'false' });
    const missing = mockElement({});

    expect(attrs.isDismissed.parseHTML!(asHTMLElement(dismissed))).toBe(true);
    expect(attrs.isDismissed.parseHTML!(asHTMLElement(unsupported))).toBe(false);
    expect(attrs.isDismissed.parseHTML!(asHTMLElement(missing))).toBe(false);

    const populated = mockElement({
      'data-claim-id': 'c9',
      'data-suggested-query': 'why transformers',
      'data-claim-dismissed': 'true',
    });
    expect(attrs.claimId.parseHTML!(asHTMLElement(populated))).toBe('c9');
    expect(attrs.suggestedQuery.parseHTML!(asHTMLElement(populated))).toBe(
      'why transformers'
    );

    const empty = mockElement({});
    expect(attrs.claimId.parseHTML!(asHTMLElement(empty))).toBeNull();
    expect(attrs.suggestedQuery.parseHTML!(asHTMLElement(empty))).toBeNull();
  });

  it('styles dismissed claims differently from unsupported claims', () => {
    const renderDismissed = callMethod<[string, Record<string, unknown>]>(
      ext,
      'renderHTML',
      {
        HTMLAttributes: {},
        mark: { attrs: { claimId: 'c1', isDismissed: true } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    expect(renderDismissed[1]['data-claim-id']).toBe('c1');
    expect(renderDismissed[1]['data-claim-dismissed']).toBe('true');
    expect(renderDismissed[1].class).toBe('claim-dismissed');

    const renderUnsupported = callMethod<[string, Record<string, unknown>]>(
      ext,
      'renderHTML',
      {
        HTMLAttributes: {},
        mark: {
          attrs: { claimId: 'c2', isDismissed: false, suggestedQuery: 'transformer efficiency' },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    expect(renderUnsupported[1].class).toContain('claim-unsupported');
    expect(renderUnsupported[1]['data-suggested-query']).toBe('transformer efficiency');
  });
});

describe('GhostText plugin state machine', () => {
  const ext = GhostText as unknown as ExtensionLike;

  type PluginStateSpec = {
    init: () => GhostTextState;
    apply: (tr: unknown, prevState: GhostTextState) => GhostTextState;
  };

  type ProseMirrorPluginStub = { key?: string; spec: { state: PluginStateSpec } };

  const plugins = callMethod<ProseMirrorPluginStub[]>(ext, 'addProseMirrorPlugins');
  const plugin =
    plugins.find((p) => p.key === GHOST_PLUGIN_KEY) ?? plugins[0];
  const pluginState = plugin.spec.state;
  const initialState = makeInitialState();

  const makeTr = ({
    meta,
    docChanged = false,
  }: {
    meta?: Partial<GhostTextState>;
    docChanged?: boolean;
  }) => ({
    docChanged,
    getMeta: (key: unknown) =>
      key === ghostTextPluginKey && meta !== undefined ? meta : undefined,
  });

  it('registers exactly one ProseMirror plugin', () => {
    expect(plugins).toHaveLength(1);
  });

  it('initializes to inactive state', () => {
    expect(pluginState.init()).toEqual(initialState);
  });

  it('activates ghost text via plugin meta', () => {
    const next = pluginState.apply(
      makeTr({
        meta: { active: true, text: 'Suggested text', pos: 42, groundingState: 'source-grounded' },
      }),
      initialState
    );

    expect(next.active).toBe(true);
    expect(next.text).toBe('Suggested text');
    expect(next.pos).toBe(42);
    expect(next.groundingState).toBe('source-grounded');
  });

  it('clears active ghost text when the document changes', () => {
    const activeState: GhostTextState = {
      active: true,
      text: 'Draft continuation',
      pos: 10,
      groundingState: 'source-grounded',
      sources: [],
    };
    const next = pluginState.apply(makeTr({ docChanged: true }), activeState);
    expect(next).toEqual(initialState);
  });

  it('preserves state across transactions that do not change the document', () => {
    const activeState: GhostTextState = {
      active: true,
      text: 'Kept',
      pos: 5,
      groundingState: 'general-knowledge',
      sources: [],
    };
    const next = pluginState.apply(makeTr({}), activeState);
    expect(next).toBe(activeState);
  });
});

describe('GhostText commands', () => {
  const ext = GhostText as unknown as ExtensionLike;
  type CommandFactories = Record<
    string,
    (arg?: unknown) => (ctx: Record<string, unknown>) => boolean
  >;

  it('exposes setGhostText, clearGhostText, acceptGhostText command factories', () => {
    const commands = Object.keys(callMethod<CommandFactories>(ext, 'addCommands')).sort();
    expect(commands).toEqual(['acceptGhostText', 'clearGhostText', 'setGhostText']);
  });

  it('setGhostText dispatches activation meta at current selection', () => {
    const commands = callMethod<CommandFactories>(ext, 'addCommands');
    const setMeta = vi.fn();
    const tr = { setMeta };
    const state = { selection: { from: 17 } };

    const handled = commands.setGhostText!({ text: 'Continuation', groundingState: 'source-grounded' })({
      tr,
      dispatch: vi.fn(),
      state,
    });

    expect(handled).toBe(true);
    expect(setMeta).toHaveBeenCalledWith(
      ghostTextPluginKey,
      expect.objectContaining({ active: true, text: 'Continuation', pos: 17 })
    );
  });

  it('clearGhostText dispatches deactivation meta and returns true', () => {
    const commands = callMethod<CommandFactories>(ext, 'addCommands');
    const setMeta = vi.fn();

    const handled = commands.clearGhostText!()({ tr: { setMeta }, dispatch: vi.fn(), state: {} });

    expect(handled).toBe(true);
    expect(setMeta).toHaveBeenCalledWith(
      ghostTextPluginKey,
      expect.objectContaining({ active: false, text: '', pos: null })
    );
  });

  it('acceptGhostText inserts text, clears state, and fires onAccept', () => {
    const onAccept = vi.fn();
    const boundExt = { ...ext, options: { ...ext.options, onAccept } };
    const commands = callMethod<CommandFactories>(boundExt, 'addCommands');
    const insertText = vi.fn();
    const setMeta = vi.fn();
    const tr = { insertText, setMeta };
    const activeState: GhostTextState = {
      active: true,
      text: 'Accepted text',
      pos: 9,
      groundingState: 'source-grounded',
      sources: [],
    };
    const state = { [GHOST_PLUGIN_KEY]: activeState };

    const handled = commands.acceptGhostText!()({ tr, dispatch: vi.fn(), state });

    expect(handled).toBe(true);
    expect(insertText).toHaveBeenCalledWith('Accepted text', 9);
    expect(setMeta).toHaveBeenCalledWith(
      ghostTextPluginKey,
      expect.objectContaining({ active: false })
    );
    expect(onAccept).toHaveBeenCalledWith(
      'Accepted text',
      'source-grounded',
      activeState.sources
    );
  });

  it('acceptGhostText is a no-op when no ghost text is active', () => {
    const commands = callMethod<CommandFactories>(ext, 'addCommands');

    const handled = commands.acceptGhostText!()({
      tr: {},
      dispatch: undefined,
      state: { [GHOST_PLUGIN_KEY]: makeInitialState() },
    });

    expect(handled).toBe(false);
  });

  it('keyboard shortcuts accept with Tab and dismiss with Escape only when active', () => {
    const shortcuts = callMethod<Record<string, (ctx: unknown) => boolean>>(
      ext,
      'addKeyboardShortcuts'
    );
    expect(Object.keys(shortcuts).sort()).toEqual(['Escape', 'Tab']);

    const activeEditor = () => ({
      state: {
        [GHOST_PLUGIN_KEY]: { active: true, text: 'Draft', pos: 3 },
      },
      commands: {
        acceptGhostText: vi.fn(() => true),
        clearGhostText: vi.fn(() => true),
      },
    });
    const inactiveEditor = () => ({
      state: { [GHOST_PLUGIN_KEY]: makeInitialState() },
      commands: {
        acceptGhostText: vi.fn(() => true),
        clearGhostText: vi.fn(() => true),
      },
    });

    const editorA = activeEditor();
    expect(shortcuts.Tab!({ editor: editorA })).toBe(true);
    expect(editorA.commands.acceptGhostText).toHaveBeenCalledTimes(1);

    expect(shortcuts.Tab!({ editor: inactiveEditor() })).toBe(false);

    const editorE = activeEditor();
    expect(shortcuts.Escape!({ editor: editorE })).toBe(true);
    expect(editorE.commands.clearGhostText).toHaveBeenCalledTimes(1);

    expect(shortcuts.Escape!({ editor: inactiveEditor() })).toBe(false);
  });
});

describe('Node insertion commands', () => {
  type InsertFactories = Record<
    string,
    (arg?: unknown) => (ctx: Record<string, unknown>) => boolean
  >;

  it('CitationNode.insertCitation forwards typed attrs to insertContent', () => {
    const ext = CitationNode as unknown as ExtensionLike;
    const commands = callMethod<InsertFactories>(ext, 'addCommands');
    const insertContent = vi.fn(() => true);
    const attrs = { paperId: 'p9', paperTitle: 'GPT-4', authors: 'OpenAI' };

    const handled = commands.insertCitation!(attrs)({
      commands: { insertContent },
    });

    expect(handled).toBe(true);
    expect(insertContent).toHaveBeenCalledWith({ type: 'citation', attrs });
  });

  it('MathEquation.setMathEquation wraps latex into node attrs', () => {
    const ext = MathEquation as unknown as ExtensionLike;
    const commands = callMethod<InsertFactories>(ext, 'addCommands');
    const insertContent = vi.fn(() => true);

    const handled = commands.setMathEquation!('\\frac{a}{b}')({
      commands: { insertContent },
    });

    expect(handled).toBe(true);
    expect(insertContent).toHaveBeenCalledWith({
      type: 'mathEquation',
      attrs: { latex: '\\frac{a}{b}' },
    });
  });

  it('TrustMarker.insertTrustMarker forwards marker attrs to insertContent', () => {
    const ext = TrustMarker as unknown as ExtensionLike;
    const commands = callMethod<InsertFactories>(ext, 'addCommands');
    const insertContent = vi.fn(() => true);
    const attrs = { markerType: 'ai-inference' as const };

    const handled = commands.insertTrustMarker!(attrs)({
      commands: { insertContent },
    });

    expect(handled).toBe(true);
    expect(insertContent).toHaveBeenCalledWith({ type: 'trustMarker', attrs });
  });
});

describe('ClaimVerificationMark commands', () => {
  const ext = ClaimVerificationMark as unknown as ExtensionLike;
  type MarkCommandFactories = Record<string, (arg?: unknown) => (ctx: Record<string, unknown>) => boolean>;

  it('setClaimFlag sets the mark with attributes', () => {
    const commands = callMethod<MarkCommandFactories>(ext, 'addCommands');
    const setMark = vi.fn(() => true);
    const attrs = { claimId: 'claim-1', suggestedQuery: 'attention mechanism' };

    const handled = commands.setClaimFlag!(attrs)({ commands: { setMark } });

    expect(handled).toBe(true);
    expect(setMark).toHaveBeenCalledWith('claimVerification', attrs);
  });

  it('unsetClaimFlag removes the mark', () => {
    const commands = callMethod<MarkCommandFactories>(ext, 'addCommands');
    const unsetMark = vi.fn(() => true);

    const handled = commands.unsetClaimFlag!()({ commands: { unsetMark } });

    expect(handled).toBe(true);
    expect(unsetMark).toHaveBeenCalledWith('claimVerification');
  });

  it('dismissClaimFlag rewrites matching marks to dismissed across the document', () => {
    const commands = callMethod<MarkCommandFactories>(ext, 'addCommands');
    const removeMark = vi.fn();
    const addMark = vi.fn();
    const tr = { removeMark, addMark };

    const targetMark = {
      type: {
        name: 'claimVerification',
        create: vi.fn((attrs: Record<string, unknown>) => ({ attrs })),
      },
      attrs: { claimId: 'target-claim', isDismissed: false },
    };
    const otherMark = {
      type: { name: 'claimVerification', create: vi.fn() },
      attrs: { claimId: 'other-claim', isDismissed: false },
    };
    const nodes = [
      { nodeSize: 6, marks: [targetMark] },
      { nodeSize: 4, marks: [otherMark] },
      { nodeSize: 2, marks: [] },
    ];
    const state = {
      doc: {
        descendants: (callback: (node: unknown, pos: number) => void) => {
          let pos = 0;
          for (const node of nodes) {
            callback(node, pos);
            pos += node.nodeSize;
          }
        },
      },
    };

    const handled = commands.dismissClaimFlag!('target-claim')({ tr, state, dispatch: vi.fn() });

    expect(handled).toBe(true);
    expect(targetMark.type.create).toHaveBeenCalledWith({
      claimId: 'target-claim',
      isDismissed: true,
    });
    expect(removeMark).toHaveBeenCalledWith(0, 6, targetMark.type);
    expect(addMark).toHaveBeenCalledTimes(1);
    expect(otherMark.type.create).not.toHaveBeenCalled();
  });
});

describe('Attribute renderers and parsers (exhaustive)', () => {
  // IMPORTANT: instantiate addAttributes exactly once per extension. TipTap
  // attribute definitions are closures re-created per call; coverage would
  // otherwise attribute invocations to a different instance than the one run.
  type AttrDef = AttributeSpec & { renderHTML?: (attrs: Record<string, unknown>) => unknown };

  const truthyAttrs: Record<string, unknown> = {
    paperId: 'p1',
    paperTitle: 'Title',
    authors: 'Author',
    year: 2024,
    citationStyle: 'apa',
    index: 2,
    attributionScope: 'clause',
    pageNumber: 9,
    relevantPassage: 'passage text',
    latex: 'x^2',
    markerType: 'source-grounded',
    claimId: 'c1',
    suggestedQuery: 'query',
    isDismissed: true,
  };

  const exerciseAll = (
    ext: ExtensionLike,
    keys: string[]
  ): Record<string, AttrDef> => {
    const defs = callMethod<Record<string, AttrDef>>(ext, 'addAttributes');
    for (const key of keys) {
      const def = defs[key];
      expect(def, key).toBeDefined();
      def.renderHTML?.({ ...truthyAttrs });
      def.renderHTML?.({});
      def.parseHTML?.(asHTMLElement(mockElement(truthyAttrs as Record<string, string>)));
      def.parseHTML?.(asHTMLElement(mockElement({})));
    }
    return defs;
  };

  it('exercises every CitationNode attribute parser/renderer', () => {
    const ext = CitationNode as unknown as ExtensionLike;
    const defs = exerciseAll(ext, [
      'paperId',
      'paperTitle',
      'authors',
      'year',
      'citationStyle',
      'index',
      'attributionScope',
      'pageNumber',
      'relevantPassage',
    ]);

    expect(defs.relevantPassage.parseHTML!(asHTMLElement(mockElement({})))).toBeNull();
    expect(defs.year.renderHTML!({ year: null })).toEqual({});
    expect(defs.pageNumber.renderHTML!({})).toEqual({});
    expect(defs.relevantPassage.renderHTML!({})).toEqual({});
  });

  it('exercises MathEquation latex fallbacks including textContent', () => {
    const ext = MathEquation as unknown as ExtensionLike;
    const defs = exerciseAll(ext, ['latex']);

    // getAttribute null -> falls back to element.textContent; both missing -> ''
    expect(defs.latex.parseHTML!(asHTMLElement(mockElement({}, 'E=mc^2')))).toBe('E=mc^2');
    expect(defs.latex.parseHTML!(asHTMLElement(mockElement({})))).toBe('');
    expect(defs.latex.renderHTML!({ latex: 'y^2' })).toEqual({ 'data-latex': 'y^2' });
  });

  it('exercises TrustMarker provenance attribute branches', () => {
    const ext = TrustMarker as unknown as ExtensionLike;
    const defs = exerciseAll(ext, [
      'markerType',
      'index',
      'paperId',
      'paperTitle',
      'pageNumber',
      'passageText',
    ]);

    expect(defs.paperId.renderHTML!({})).toEqual({});
    expect(defs.paperTitle.renderHTML!({})).toEqual({});
    expect(defs.pageNumber.renderHTML!({})).toEqual({});
    expect(defs.passageText.renderHTML!({})).toEqual({});
  });

  it('exercises ClaimVerificationMark attribute branches', () => {
    const ext = ClaimVerificationMark as unknown as ExtensionLike;
    const defs = exerciseAll(ext, ['claimId', 'suggestedQuery', 'isDismissed']);

    expect(defs.isDismissed.renderHTML!({ isDismissed: true })).toEqual({
      'data-claim-dismissed': 'true',
    });
    expect(defs.isDismissed.renderHTML!({ isDismissed: false })).toEqual({
      'data-claim-dismissed': 'false',
    });
    expect(defs.claimId.renderHTML!({})).toEqual({});
    expect(defs.suggestedQuery.renderHTML!({})).toEqual({});
  });

  it('renders math fallback markup when KaTeX throws', () => {
    const ext = MathEquation as unknown as ExtensionLike;
    const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
      throw new Error('katex exploded');
    });

    const render = callMethod<[string, Record<string, unknown>, [string, Record<string, unknown>]]>(
      ext,
      'renderHTML',
      {
        HTMLAttributes: {},
        node: { type: { name: 'mathEquation' }, attrs: { latex: '\\broken{' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    expect(spy).toHaveBeenCalled();
    expect(render[2][1].innerHTML).toBe('\\broken{');
    spy.mockRestore();
  });
});

describe('createGhostTextSpan rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const passage = {
    paperId: 'src-1',
    paperTitle: 'Attention Paper',
    authors: 'Vaswani et al.',
    pageNumber: 4,
    passageText: 'the transformer architecture',
    confidence: 0.9,
  };

  it('renders a plain italic span without badge when not source-grounded', () => {
    const span = createGhostTextSpan('Suggested words', 'general-knowledge', [], undefined);
    expect(span.getAttribute('data-ghost-text')).toBe('true');
    expect(span.className).toContain('ghost-text-preview');
    expect(span.textContent).toBe('Suggested words');
    expect(span.querySelector('.source-preview-badge')).toBeNull();
  });

  it('appends a grounding badge for source-grounded suggestions', () => {
    const onInspect = vi.fn();
    const span = createGhostTextSpan('Draft', 'source-grounded', [passage], onInspect);
    const badge = span.querySelector('.source-preview-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Vaswani et al.');
    expect(badge!.getAttribute('title')).toContain('Attention Paper');

    (badge as HTMLElement).onclick?.({
      stopPropagation: () => {},
      preventDefault: () => {},
    } as unknown as PointerEvent);
    expect(onInspect).toHaveBeenCalledWith('src-1', 4, 'the transformer architecture');
  });

  it('falls back to Source/Paper labels when the passage lacks metadata', () => {
    const span = createGhostTextSpan(
      'Draft',
      'source-grounded',
      [{ ...passage, authors: '', paperTitle: '' }],
      vi.fn()
    );
    const badge = span.querySelector('.source-preview-badge') as HTMLElement;
    expect(badge.textContent).toContain('Source');
    expect(badge.title).toContain('Paper');
  });

  it('clicking the badge is a no-op without onInspectSource or a paper id', () => {
    const noHandler = createGhostTextSpan('D', 'source-grounded', [passage], undefined);
    const badgeA = noHandler.querySelector('.source-preview-badge') as HTMLElement;
    expect(() =>
      badgeA.onclick?.({ stopPropagation: () => {}, preventDefault: () => {} } as unknown as PointerEvent)
    ).not.toThrow();

    const noPaperId = createGhostTextSpan(
      'D',
      'source-grounded',
      [{ ...passage, paperId: '' }],
      vi.fn()
    );
    const inspectSpy = vi.fn();
    const spanWithSpy = createGhostTextSpan('D', 'source-grounded', [{ ...passage, paperId: '' }], inspectSpy);
    const badgeB = spanWithSpy.querySelector('.source-preview-badge') as HTMLElement;
    badgeB.onclick?.({ stopPropagation: () => {}, preventDefault: () => {} } as unknown as PointerEvent);
    void noPaperId;
    expect(inspectSpy).not.toHaveBeenCalled();
  });
});

describe('GhostText decorations prop', () => {
  const ext = GhostText as unknown as ExtensionLike;

  type ProseMirrorPluginStub = {
    key?: string;
    spec: {
      state: PluginStateSpecLike;
      props?: { decorations?: (state: unknown) => DecorationSet };
    };
  };
  type PluginStateSpecLike = {
    init: () => GhostTextState;
    apply: (tr: unknown, prevState: GhostTextState) => GhostTextState;
  };

  const plugins = callMethod<ProseMirrorPluginStub[]>(ext, 'addProseMirrorPlugins');
  const plugin = plugins[0];

  // Minimal real ProseMirror document so DecorationSet.create can traverse it
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'text*' },
      text: { inline: true },
    },
  });
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello world')])]);
  const docSize = doc.content.size; // 13

  const stateFor = (pluginState?: GhostTextState) => ({
    ...(pluginState !== undefined ? { [GHOST_PLUGIN_KEY]: pluginState } : {}),
    doc,
  });

  it.each([
    ['undefined plugin state', undefined],
    ['inactive state', makeInitialState()],
    ['active with empty text', { ...makeInitialState(), active: true }],
    ['active with null pos', { ...makeInitialState(), active: true, text: 'X', pos: null }],
  ])('returns an empty decoration set for %s', (_label, pluginState) => {
    const result = plugin.spec.props!.decorations!(stateFor(pluginState));
    expect(result).toBe(DecorationSet.empty);
  });

  it('returns an empty set when the stored position exceeds the document size', () => {
    const stale = { ...makeInitialState(), active: true, text: 'Beyond', pos: docSize + 50 };
    expect(plugin.spec.props!.decorations!(stateFor(stale))).toBe(DecorationSet.empty);
  });

  it('creates a widget decoration at a valid position for active ghost text', () => {
    const active: GhostTextState = {
      active: true,
      text: 'Suggested continuation',
      pos: 5,
      groundingState: 'general-knowledge',
      sources: [],
    };
    const result = plugin.spec.props!.decorations!(stateFor(active));
    expect(result).not.toBe(DecorationSet.empty);

    const found = result.find();
    expect(found).toHaveLength(1);
    expect(found[0].from).toBe(5);

    // The widget's toDOM callback delegates to createGhostTextSpan
    const widgetSpec = found[0] as unknown as { type: { toDOM: (view: unknown) => HTMLElement } };
    const widgetToDOM = widgetSpec.type.toDOM;
    const el = widgetToDOM(null);
    expect(el.getAttribute('data-ghost-text')).toBe('true');
    expect(el.textContent).toBe('Suggested continuation');
  });

  it('Tab shortcut does not accept ghost text whose content is empty', () => {
    const shortcuts = callMethod<Record<string, (ctx: unknown) => boolean>>(ext, 'addKeyboardShortcuts');
    const editor = {
      state: { [GHOST_PLUGIN_KEY]: { ...makeInitialState(), active: true, text: '', pos: 3 } },
      commands: { acceptGhostText: vi.fn(() => true) },
    };
    expect(shortcuts.Tab!({ editor })).toBe(false);
    expect(editor.commands.acceptGhostText).not.toHaveBeenCalled();
  });

  it('acceptGhostText refuses inactive, empty-text, and null-pos states individually', () => {
    const commands = callMethod<Record<string, (arg?: unknown) => (ctx: Record<string, unknown>) => boolean>>(
      ext,
      'addCommands'
    );
    const accept = commands.acceptGhostText!();

    expect(accept({ tr: {}, dispatch: undefined, state: {} })).toBe(false); // state undefined
    expect(
      accept({ tr: {}, dispatch: undefined, state: { [GHOST_PLUGIN_KEY]: { ...makeInitialState(), active: true } } })
    ).toBe(false); // no text
    expect(
      accept({
        tr: {},
        dispatch: undefined,
        state: {
          [GHOST_PLUGIN_KEY]: { ...makeInitialState(), active: true, text: 'T' },
        },
      })
    ).toBe(false); // null pos
  });
});


describe('TipTap parse-rule lifecycles', () => {
  it('declares DOM parse rules for each custom node and mark', () => {
    expect(
      callMethod<{ tag: string }[]>(CitationNode as unknown as ExtensionLike, 'parseHTML')
    ).toEqual([{ tag: 'span[data-citation-node]' }]);

    expect(
      callMethod<{ tag: string }[]>(MathEquation as unknown as ExtensionLike, 'parseHTML')
    ).toEqual([{ tag: 'span[data-latex]' }]);

    expect(
      callMethod<{ tag: string }[]>(TrustMarker as unknown as ExtensionLike, 'parseHTML')
    ).toEqual([{ tag: 'span[data-trust-marker]' }]);

    expect(
      callMethod<{ tag: string }[]>(ClaimVerificationMark as unknown as ExtensionLike, 'parseHTML')
    ).toEqual([{ tag: 'span[data-claim-flag]' }]);
  });

  it('renders empty-latex nodes via the falsy attr fallbacks', () => {
    const ext = MathEquation as unknown as ExtensionLike;
    const render = callMethod<[string, Record<string, unknown>, [string, Record<string, unknown>]]>(
      ext,
      'renderHTML',
      {
        HTMLAttributes: {},
        node: { type: { name: 'mathEquation' }, attrs: { latex: '' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );
    expect(render[1].title).toBe('LaTeX: ');
    expect(render[2][0]).toBe('span');
  });
});

describe('Fallback-arm sweeps', () => {
  const extOf = (e: unknown) => e as ExtensionLike;

  it('CitationNode renderHTML falls back for missing style/index/authors/year', () => {
    const render = callMethod<[string, Record<string, unknown>, string]>(
      extOf(CitationNode),
      'renderHTML',
      {
        HTMLAttributes: {},
        node: {
          type: { name: 'citation' },
          attrs: { paperId: 'p9', paperTitle: 'Sparse', authors: ',', year: null, citationStyle: null, index: 0 },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );
    expect(render[0]).toBe('span');
    expect(typeof render[2]).toBe('string');
    expect(render[2].length).toBeGreaterThan(0);
  });

  it('TrustMarker renderHTML falls back for minimal and malformed attrs', () => {
    const bare = callMethod<[string, Record<string, unknown>, string]>(
      extOf(TrustMarker),
      'renderHTML',
      { HTMLAttributes: {}, node: { type: { name: 'trustMarker' }, attrs: { markerType: 'source-grounded' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );
    expect(bare[1].title).toContain('Retrieved paper');
    expect(bare[1].title).toContain('(P.1)');
    expect(typeof bare[2]).toBe('string');

    const inference = callMethod<[string, Record<string, unknown>, string]>(
      extOf(TrustMarker),
      'renderHTML',
      { HTMLAttributes: {}, node: { type: { name: 'trustMarker' }, attrs: {} } } as never
    );
    expect(inference[2]).toBe(String.fromCharCode(0x223f)); // inference glyph

    const weirdIndex = callMethod<[string, Record<string, unknown>, string]>(
      extOf(TrustMarker),
      'renderHTML',
      {
        HTMLAttributes: {},
        node: { type: { name: 'trustMarker' }, attrs: { markerType: 'source-grounded', index: '1x4' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );
    expect(weirdIndex[2]).toBe('¹x⁴');
  });

  it('MathEquation catch-path also falls back to empty string for blank latex', () => {
    const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
      throw new Error('boom');
    });
    const render = callMethod<[string, Record<string, unknown>, [string, Record<string, unknown>]]>(
      extOf(MathEquation),
      'renderHTML',
      { HTMLAttributes: {}, node: { type: { name: 'mathEquation' }, attrs: { latex: '' } } } as never
    );
    expect(render[2][1].innerHTML).toBe('');
    spy.mockRestore();
  });

  it('command factories tolerate absent dispatch and default ghost-text fields', () => {
    const ghost = extOf(GhostText);
    const commands = callMethod<Record<string, (arg?: unknown) => (ctx: Record<string, unknown>) => boolean>>(
      ghost,
      'addCommands'
    );

    // setGhostText without dispatch -> no-op success; defaults applied on dispatch path
    expect(
      commands.setGhostText!({ text: 'T' })({ tr: { setMeta: vi.fn() }, dispatch: undefined, state: {} })
    ).toBe(true);

    const setMeta = vi.fn();
    commands.setGhostText!({ text: 'Defaults' })({ tr: { setMeta }, dispatch: vi.fn(), state: { selection: { from: 0 } } });
    expect(setMeta).toHaveBeenCalledWith(
      ghostTextPluginKey,
      expect.objectContaining({ groundingState: 'general-knowledge', sources: [] })
    );

    // clearGhostText without dispatch -> no-op success
    expect(commands.clearGhostText!()({ tr: {}, dispatch: undefined, state: {} })).toBe(true);
  });

  it('keyboard shortcuts treat a missing plugin state as inactive', () => {
    const shortcuts = callMethod<Record<string, (ctx: unknown) => boolean>>(extOf(GhostText), 'addKeyboardShortcuts');
    const editorNoState = {
      state: {},
      commands: { acceptGhostText: vi.fn(() => true), clearGhostText: vi.fn(() => true) },
    };
    expect(shortcuts.Tab!({ editor: editorNoState })).toBe(false);
    expect(shortcuts.Escape!({ editor: editorNoState })).toBe(false);
    expect(editorNoState.commands.acceptGhostText).not.toHaveBeenCalled();
  });

  it('dismissClaimFlag is an inert success without dispatch', () => {
    const commands = callMethod<Record<string, (arg?: unknown) => (ctx: Record<string, unknown>) => boolean>>(
      extOf(ClaimVerificationMark),
      'addCommands'
    );
    expect(
      commands.dismissClaimFlag!('any-id')({ tr: {}, state: { doc: { descendants: vi.fn() } }, dispatch: undefined })
    ).toBe(true);
  });
});

describe('Final fallback arms', () => {
  it('citation title template falls back on empty authors', () => {
    const render = callMethod<[string, Record<string, unknown>, string]>(
      CitationNode as unknown as ExtensionLike,
      'renderHTML',
      {
        HTMLAttributes: {},
        node: {
          type: { name: 'citation' },
          attrs: { paperId: 'p', paperTitle: 'T', authors: '', year: null, index: 1 },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );
    expect(render[2]).toContain('Unknown');
    expect(render[2]).toContain('n.d.');
  });

  it('trustMarker passageText renderer emits data attribute when set', () => {
    const ext = TrustMarker as unknown as ExtensionLike;
    const defs = callMethod<Record<string, AttributeSpec & { renderHTML?: (a: unknown) => unknown }>>(
      ext,
      'addAttributes'
    );
    expect(defs.passageText.renderHTML!({ passageText: 'key passage' })).toEqual({
      'data-passage-text': 'key passage',
    });
  });

  it('acceptGhostText succeeds silently when dispatch is absent but state is active', () => {
    const ghost = GhostText as unknown as ExtensionLike;
    const commands = callMethod<Record<string, (arg?: unknown) => (ctx: Record<string, unknown>) => boolean>>(
      ghost,
      'addCommands'
    );
    const activeState = { ...makeInitialState(), active: true, text: 'T', pos: 4 };
    const handled = commands.acceptGhostText!()({
      tr: { insertText: vi.fn(), setMeta: vi.fn() },
      dispatch: undefined,
      state: { [GHOST_PLUGIN_KEY]: activeState },
    });
    expect(handled).toBe(true);
  });
});

it('handles a ghost-text source list containing an undefined entry', () => {
  const inspect = vi.fn();
  const span = createGhostTextSpan(
    'Draft',
    'source-grounded',
    [undefined as never],
    inspect
  );
  expect(span.querySelector('.source-preview-badge')).toBeNull();
  expect(inspect).not.toHaveBeenCalled();
});
