import { AIOutlineRequest, AIOutlineResponse, GroundedPassage, AIEditActionType } from '../types';

export const EDIT_ACTION_INSTRUCTIONS: Record<AIEditActionType, string> = {
  clarity: 'Rewrite the text to remove ambiguity and streamline sentence syntax. Preserve meaning.',
  academic: 'Rewrite the text in a formal scholarly register using precise scientific terminology.',
  simplify: 'Rewrite the text into clear, readable concepts without losing precision.',
  shorten: 'Condense the text, pruning filler phrases while retaining core analytical claims.',
  expand: 'Elaborate the text with academic rationale and methodological implications.',
  grammar: 'Correct punctuation, subject-verb agreement, and typographical issues only.',
  flow: 'Improve transitions and logical connectives between sentences.',
  translate: 'Translate the text accurately into the requested target language, keeping scientific conventions.',
  explain: 'Deconstruct the core hypotheses, mechanisms, and experimental implications of the passage.',
};

export function buildGroundingBlock(passages?: GroundedPassage[]): string {
  if (!passages || passages.length === 0) return '';
  const blocks = passages
    .map(
      (p, i) =>
        `[${i + 1}] ${p.paperTitle}${p.authors ? ` — ${p.authors}` : ''} (${p.year ?? 'n.d.'}): ${p.passageText}`
    )
    .join('\n');
  return `\n\nGrounded sources:\n${blocks}`;
}

export function measureLatencyMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

const OUTLINE_SCAFFOLD: Array<{ title: string; description: string; keyPoints: string[] }> = [
  {
    title: '1. Introduction',
    description: 'Overview, problem formulation, and research objectives.',
    keyPoints: ['Motivation and significance', 'Formal research question', 'Contributions and paper organization'],
  },
  {
    title: '2. Background & Related Work',
    description: 'Taxonomy of prior investigations and foundational architectures.',
    keyPoints: ['Foundational theoretical models', 'Modern benchmarks and baselines', 'Limitations of current approaches'],
  },
  {
    title: '3. Proposed Methodology',
    description: 'Algorithmic formulation, system architecture, and formal properties.',
    keyPoints: ['Core architecture', 'Optimization objectives', 'Complexity analysis'],
  },
  {
    title: '4. Experimental Setup & Benchmarks',
    description: 'Evaluation protocols, datasets, baseline configurations, and metrics.',
    keyPoints: ['Dataset selection and preprocessing', 'Evaluation metrics', 'Ablation parameters'],
  },
  {
    title: '5. Results & Empirical Analysis',
    description: 'Quantitative benchmarking results, comparative tables, and ablation findings.',
    keyPoints: ['Primary benchmark comparison', 'Ablation studies', 'Error analysis'],
  },
  {
    title: '6. Discussion & Conclusion',
    description: 'Implications, limitations, threats to validity, and future work.',
    keyPoints: ['Theoretical and practical implications', 'Bounded constraints', 'Future directions'],
  },
];

/**
 * Deterministic outline scaffold. Outline structure is a product-defined feature;
 * providers that support it can refine section descriptions via their model.
 */
export function outlineFromScaffold(request: AIOutlineRequest, latencyMs: number): AIOutlineResponse {
  const count = Math.min(Math.max(request.targetSectionsCount ?? OUTLINE_SCAFFOLD.length, 3), OUTLINE_SCAFFOLD.length);
  const sections = OUTLINE_SCAFFOLD.slice(0, count).map((sec, idx) => ({
    id: String(idx + 1),
    title: sec.title,
    level: 1 as const,
    description: sec.description,
    keyPoints: sec.keyPoints,
  }));

  return {
    topic: request.topic,
    researchQuestion: request.researchQuestion,
    sections,
    estimatedWordCount: sections.length * 650,
    groundingState: 'general-knowledge',
    sources: [],
    latencyMs,
  };
}
