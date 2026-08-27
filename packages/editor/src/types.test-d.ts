import { describe, it, expectTypeOf } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import type { CitationStyle, BibliographicReference } from '@openresearch/citations';
import type { AIEditActionType, GroundedPassage, GroundingState } from '@openresearch/ai';
import type {
  EditorConfig,
  EditorDocumentState,
  EditorStats,
  EditorActionHandlers,
  AcademicEditorProps,
} from './types';

describe('Editor Type-Level Assertions', () => {
  it('validates EditorStats numeric fields', () => {
    expectTypeOf<EditorStats>().toHaveProperty('words');
    expectTypeOf<EditorStats['words']>().toEqualTypeOf<number>();
    expectTypeOf<EditorStats['characters']>().toEqualTypeOf<number>();
    expectTypeOf<EditorStats['readingTimeMinutes']>().toEqualTypeOf<number>();
  });

  it('validates EditorConfig optional flags', () => {
    expectTypeOf<EditorConfig['editable']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<EditorConfig['enableGhostText']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<EditorConfig['placeholder']>().toEqualTypeOf<string | undefined>();
  });

  it('validates EditorDocumentState content typing', () => {
    expectTypeOf<EditorDocumentState>().toHaveProperty('id');
    expectTypeOf<EditorDocumentState>().toHaveProperty('contentJson');
    expectTypeOf<EditorDocumentState['contentJson']>().toEqualTypeOf<
      JSONContent | Record<string, unknown>
    >();
  });

  it('validates handler callback signatures', () => {
    expectTypeOf<
      EditorActionHandlers['onSave']
    >().toEqualTypeOf<
      ((contentJson: JSONContent, plainText: string) => Promise<void> | void) | undefined
    >();
    expectTypeOf<
      EditorActionHandlers['onCitationInserted']
    >().toEqualTypeOf<((paper: BibliographicReference) => void) | undefined>();
    expectTypeOf<
      EditorActionHandlers['onCitationDeleted']
    >().toEqualTypeOf<((paperId: string) => void) | undefined>();
    expectTypeOf<
      EditorActionHandlers['onInspectSource']
    >().toEqualTypeOf<
      ((paperId: string, pageNumber?: number, relevantPassage?: string) => void) | undefined
    >();
    expectTypeOf<EditorActionHandlers['onTriggerAIEdit']>().toMatchTypeOf<
      ((selectedText: string, action: AIEditActionType, targetLanguage?: string) => void) | undefined
    >();
  });

  it('validates ghost text request return shape', () => {
    const request = expectTypeOf<
      NonNullable<EditorActionHandlers['onGhostTextRequest']>
    >();
    request.returns.toMatchTypeOf<
      Promise<{ text: string; groundingState: GroundingState; sources: GroundedPassage[] } | null>
    >();
  });

  it('bundles handlers into AcademicEditorProps', () => {
    expectTypeOf<AcademicEditorProps>().toHaveProperty('handlers');
    expectTypeOf<AcademicEditorProps['handlers']>().toEqualTypeOf<EditorActionHandlers | undefined>();
    expectTypeOf<AcademicEditorProps>().toHaveProperty('initialContent');
    expectTypeOf<AcademicEditorProps['citationStyle']>().toEqualTypeOf<
      CitationStyle | undefined
    >();
    expectTypeOf<AcademicEditorProps['providerLatencyTier']>().toEqualTypeOf<
      'fast' | 'moderate' | 'slow' | undefined
    >();
  });
});
