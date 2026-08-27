/**
 * LLM and AI Grounding types
 */

export type GroundingState = 'source-grounded' | 'ai-inference' | 'general-knowledge';

export type ChatMode = 'document' | 'library' | 'project' | 'general';

export interface GroundedPassage {
  paperId: string;
  paperTitle: string;
  authors: string;
  year?: number;
  pageNumber?: number;
  section?: string;
  paragraph?: number;
  passageText: string;
  confidence: number;
  chunkId?: string;
  score?: number;
}

export interface GroundedSegment {
  text: string;
  groundingState: GroundingState;
  sourceIndices?: number[];
  sourcePassage?: GroundedPassage;
  attributionScope: 'sentence' | 'clause';
}

export interface TrustLegend {
  sourceGroundedCount: number;
  aiInferenceCount: number;
  generalKnowledgeCount: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  mode: ChatMode;
  paperId?: string;
  paperIds?: string[];
  conversationHistory?: LLMMessage[];
}

export interface ChatResponse {
  answer: string;
  mode: ChatMode;
  groundingState: GroundingState;
  segments: GroundedSegment[];
  sources: GroundedPassage[];
  trustLegend: TrustLegend;
  insufficientEvidence: boolean;
  insufficientEvidenceReason?: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface AutocompleteOptions {
  prefixText: string;
  suffixText?: string;
  paragraphContext: string;
  sectionHeading?: string;
  groundingPassages?: GroundedPassage[];
  mode: 'ghost' | 'continuation';
}

export interface AutocompleteResult {
  text: string;
  groundingState: GroundingState;
  sourcePassages: GroundedPassage[];
  latencyMs: number;
}

export type AIEditActionType =
  | 'clarity'
  | 'academic'
  | 'simplify'
  | 'shorten'
  | 'expand'
  | 'grammar'
  | 'flow'
  | 'translate'
  | 'explain';

export interface AIEditRequest {
  text: string;
  action: AIEditActionType;
  targetLanguage?: string;
  paragraphContext?: string;
  surroundingContext?: string;
  groundingPassages?: GroundedPassage[];
}

export interface AIEditResponse {
  originalText: string;
  suggestedText: string;
  action: AIEditActionType;
  explanation?: string;
  groundingState: GroundingState;
  changesSummary?: string;
  latencyMs: number;
}

export interface AIOutlineSection {
  id: string;
  title: string;
  level: number;
  description?: string;
  keyPoints?: string[];
  suggestedPassages?: GroundedPassage[];
}

export interface AIOutlineRequest {
  topic: string;
  researchQuestion?: string;
  paperIds?: string[];
  targetSectionsCount?: number;
  contextNotes?: string;
}

export interface AIOutlineResponse {
  topic: string;
  researchQuestion?: string;
  sections: AIOutlineSection[];
  estimatedWordCount?: number;
  groundingState: GroundingState;
  sources: GroundedPassage[];
  latencyMs: number;
}

export interface AIQuotaConfig {
  hourlySuggestionCap: number; // e.g. 50, 100, 200, or -1 for unlimited
  sessionSuggestionCap: number;
  enableGhostText: boolean;
}

// --- Phase 8 Intelligence Types ---

export interface ClaimFlag {
  claimId: string;
  text: string;
  flagType: 'no_supporting_citation';
  message: string;
  suggestedQuery: string;
  startChar?: number;
  endChar?: number;
  isDismissed: boolean;
}

export interface ClaimVerificationResult {
  totalClaims: number;
  unsupportedClaims: number;
  dismissedClaims: number;
  claims: ClaimFlag[];
  confidenceScoreDeferred: boolean; // Explicitly document deferred scoring
}

export interface AuthorLimitation {
  paperId: string;
  paperTitle: string;
  authors: string;
  year?: number;
  pageNumber: number;
  section: string;
  excerpt: string;
  paraphrasedLimitation: string;
}

export interface FutureWorkItem {
  paperId: string;
  paperTitle: string;
  authors: string;
  year?: number;
  pageNumber: number;
  section: string;
  excerpt: string;
  paraphrasedOpportunity: string;
}

export interface PotentialResearchGap {
  id: string;
  title: string;
  category: 'dataset' | 'methodology' | 'evaluation' | 'scalability' | 'general';
  description: string;
  rawEvidenceCount: number;
  supportingPapersCount: number;
  authorLimitations: AuthorLimitation[];
  futureWorkQuotes: FutureWorkItem[];
  unsupportedClaims: string[];
}

export interface ResearchGapsResult {
  analyzedPapersCount: number;
  potentialGaps: PotentialResearchGap[];
  disclaimer: string; // "Potential research gaps based on author limitations and citation analysis. Requires researcher verification."
  confidenceScoreDeferred: boolean;
}

export interface LitMatrixCell {
  value: string;
  paperId: string;
  paperTitle: string;
  pageNumber?: number;
  section?: string;
  sourceExcerpt?: string;
}

export interface LitMatrixRow {
  paperId: string;
  paperTitle: string;
  authors: string;
  year?: number;
  doi?: string;
  method: LitMatrixCell;
  dataset: LitMatrixCell;
  results: LitMatrixCell;
  limitations: LitMatrixCell;
}

export interface LiteratureMatrixResult {
  headers: string[];
  rows: LitMatrixRow[];
  markdownTable: string;
  totalPapers: number;
}

export type ReviewCategoryType = 'structure' | 'citations' | 'writing' | 'argumentation' | 'sources';
export type ReviewIssueSeverity = 'warning' | 'suggestion' | 'good';

export interface ReviewIssue {
  id: string;
  category: ReviewCategoryType;
  severity: ReviewIssueSeverity;
  title: string;
  description: string;
  flaggedText?: string;
  suggestion: string;
  suggestedAction?: string;
}

export interface ReviewCategorySummary {
  category: ReviewCategoryType;
  score: number; // 0 - 100
  totalIssues: number;
  warnings: number;
  suggestions: number;
  summaryText: string;
}

export interface PaperReviewResult {
  documentId: string;
  documentTitle: string;
  overallScore: number;
  categories: Record<ReviewCategoryType, ReviewCategorySummary>;
  issues: ReviewIssue[];
  analyzedAt: string;
}


