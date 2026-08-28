import type { JSONContent } from '@tiptap/core';
import { BibliographicReference, CitationStyle } from '@openresearch/citations';
import { AIEditActionType, GroundedPassage, GroundingState } from '@openresearch/ai';

export interface EditorConfig {
  placeholder?: string;
  autofocus?: boolean;
  editable?: boolean;
  enableGhostText?: boolean;
  enableCitations?: boolean;
}

export interface EditorDocumentState {
  id: string;
  title: string;
  contentJson: JSONContent | Record<string, unknown>;
  plainText: string;
  wordCount: number;
  lastSavedAt?: Date;
}

export interface EditorStats {
  words: number;
  characters: number;
  readingTimeMinutes: number;
}

export interface EditorActionHandlers {
  onUpdate?: (contentJson: JSONContent, plainText: string, stats: EditorStats) => void;
  onSave?: (contentJson: JSONContent, plainText: string) => Promise<void> | void;
  onCitationInserted?: (paper: BibliographicReference) => void;
  onCitationDeleted?: (paperId: string) => void;
  onInspectSource?: (paperId: string, pageNumber?: number, relevantPassage?: string) => void;
  onOpenAddByIdentifier?: () => void;
  onTriggerContinuation?: (prefixText: string, paragraphContext: string, sectionHeading?: string) => void;
  onTriggerAIEdit?: (selectedText: string, action: AIEditActionType, targetLanguage?: string) => void;
  onOpenOutlineModal?: () => void;
  onOpenExportModal?: () => void;
  onInspectClaim?: (claimId: string, text: string, suggestedQuery?: string) => void;
  onDismissClaim?: (claimId: string) => void;
  onGhostTextRequest?: (prefixText: string, paragraphContext: string, sectionHeading?: string) => Promise<{
    text: string;
    groundingState: GroundingState;
    sources: GroundedPassage[];
  } | null>;
  onFocusChange?: (focused: boolean) => void;
  onRegisterContinuationInserter?: (fn: (text: string) => boolean) => void;
}

export interface AcademicEditorProps extends EditorActionHandlers {
  initialContent?: JSONContent | Record<string, unknown> | string;
  editable?: boolean;
  placeholder?: string;
  citationStyle?: CitationStyle;
  libraryPapers?: BibliographicReference[];
  enableGhostText?: boolean;
  providerLatencyTier?: 'fast' | 'moderate' | 'slow';
  /** When true, unsaved changes are saved automatically every autoSaveIntervalMs (default: true) */
  autoSaveEnabled?: boolean;
  /** Autosave cadence in milliseconds (default: 15000) */
  autoSaveIntervalMs?: number;
  handlers?: EditorActionHandlers;
  className?: string;
}
