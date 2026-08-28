'use client';

import React from 'react';
import { AIContinuationCard, AIEditReviewCard } from '@openresearch/editor';
import { AIEditActionType, GroundedPassage, GroundingState } from '@openresearch/ai';

interface AIWritingFloatingOverlayProps {
  isContinuationOpen: boolean;
  isContinuationLoading: boolean;
  continuationText: string;
  continuationError?: string | null;
  continuationGroundingState: GroundingState;
  continuationSources: GroundedPassage[];
  continuationLatency: number;
  onAcceptContinuation: () => void;
  onRegenerateContinuation: () => void;
  onDismissContinuation: () => void;
  onInspectSource: (paperId: string, pageNumber?: number, passageText?: string) => void;

  isEditReviewOpen: boolean;
  isEditReviewLoading: boolean;
  editAction: AIEditActionType;
  editOriginalText: string;
  editSuggestedText: string;
  editExplanation?: string;
  editChangesSummary?: string;
  editGroundingState: GroundingState;
  editSources: GroundedPassage[];
  editLatency: number;
  onAcceptEdit: () => void;
  onRejectEdit: () => void;
  onRegenerateEdit: () => void;
}

export const AIWritingFloatingOverlay: React.FC<AIWritingFloatingOverlayProps> = ({
  isContinuationOpen,
  isContinuationLoading,
  continuationText,
  continuationError,
  continuationGroundingState,
  continuationSources,
  continuationLatency,
  onAcceptContinuation,
  onRegenerateContinuation,
  onDismissContinuation,
  onInspectSource,

  isEditReviewOpen,
  isEditReviewLoading,
  editAction,
  editOriginalText,
  editSuggestedText,
  editExplanation,
  editChangesSummary,
  editGroundingState,
  editSources,
  editLatency,
  onAcceptEdit,
  onRejectEdit,
  onRegenerateEdit,
}) => {
  return (
    <>
      {/* Floating Paragraph Continuation Card (Ctrl+/) */}
      <AIContinuationCard
        isOpen={isContinuationOpen}
        isLoading={isContinuationLoading}
        continuationText={continuationText}
        error={continuationError}
        groundingState={continuationGroundingState}
        sources={continuationSources}
        latencyMs={continuationLatency}
        onAccept={onAcceptContinuation}
        onRegenerate={onRegenerateContinuation}
        onDismiss={onDismissContinuation}
        onInspectSource={onInspectSource}
      />

      {/* Reversible AI Edit Review Card */}
      <AIEditReviewCard
        isOpen={isEditReviewOpen}
        isLoading={isEditReviewLoading}
        action={editAction}
        originalText={editOriginalText}
        suggestedText={editSuggestedText}
        explanation={editExplanation}
        changesSummary={editChangesSummary}
        groundingState={editGroundingState}
        sources={editSources}
        latencyMs={editLatency}
        onAccept={onAcceptEdit}
        onReject={onRejectEdit}
        onRegenerate={onRegenerateEdit}
        onInspectSource={onInspectSource}
      />
    </>
  );
};
