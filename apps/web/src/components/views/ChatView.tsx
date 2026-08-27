'use client';

import React, { useEffect } from 'react';
import { AiResearchChat } from '../chat/AiResearchChat';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { GroundedPassage as ChatGroundedPassage } from '../chat/AiResearchChat';

export const ChatView: React.FC = () => {
  const w = useWorkspace();

  // Consume the one-shot navigation seed so revisiting /chat starts fresh
  // unless it was explicitly seeded again via openChatForPaper().
  useEffect(() => {
    return () => w.clearChatSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AiResearchChat
      initialPaperId={w.chatInitialPaperId}
      onSelectSource={(source: ChatGroundedPassage) => {
        w.setActiveChatSource(source);
        w.setSourcePanelCollapsed(false);
      }}
      onOpenPaperInReader={(paperId: string) => w.openReaderForPaper(paperId)}
    />
  );
};
