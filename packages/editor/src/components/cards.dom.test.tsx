// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AIContinuationCard } from './AIContinuationCard';
import { AIEditReviewCard } from './AIEditReviewCard';
import { CitationPopover } from './CitationPopover';

describe('Editor Cards & Popovers DOM Tests', () => {
  function renderIntoDom(element: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => {
      root.render(element);
    });
    return {
      container,
      cleanup: () => {
        root.unmount();
        container.remove();
      },
    };
  }

  describe('AIContinuationCard', () => {
    it('renders continuation card with text, sources, and latency', () => {
      const onAccept = vi.fn();
      const onRegenerate = vi.fn();
      const onDismiss = vi.fn();
      const onInspectSource = vi.fn();

      const sources = [
        {
          paperId: 'p1',
          paperTitle: 'Attention Paper',
          authors: 'Vaswani et al.',
          year: 2017,
          pageNumber: 3,
          passageText: 'Scaled dot-product attention...',
          confidence: 1.0,
        },
      ];

      const { container, cleanup } = renderIntoDom(
        <AIContinuationCard
          isOpen={true}
          isLoading={false}
          continuationText="This shows transformer architectures achieve state-of-the-art results."
          groundingState="source-grounded"
          sources={sources}
          latencyMs={120}
          onAccept={onAccept}
          onRegenerate={onRegenerate}
          onDismiss={onDismiss}
          onInspectSource={onInspectSource}
        />
      );

      expect(document.body.textContent).toContain('AI Paragraph Continuation');
      expect(document.body.textContent).toContain('This shows transformer architectures achieve state-of-the-art results.');
      expect(document.body.textContent).toContain('Source Grounded (1)');
      expect(document.body.textContent).toContain('120ms');

      const acceptBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Accept')
      );
      acceptBtn?.click();
      expect(onAccept).toHaveBeenCalled();

      cleanup();
    });

    it('renders loading and error states', () => {
      const { container, cleanup } = renderIntoDom(
        <AIContinuationCard
          isOpen={true}
          isLoading={true}
          continuationText=""
          groundingState="general-knowledge"
          sources={[]}
          onAccept={() => {}}
          onRegenerate={() => {}}
          onDismiss={() => {}}
        />
      );
      expect(document.body.textContent).toContain('Synthesizing literature-grounded continuation...');
      cleanup();

      const { container: c2, cleanup: cleanup2 } = renderIntoDom(
        <AIContinuationCard
          isOpen={true}
          isLoading={false}
          error="Network timeout"
          continuationText=""
          groundingState="general-knowledge"
          sources={[]}
          onAccept={() => {}}
          onRegenerate={() => {}}
          onDismiss={() => {}}
        />
      );
      expect(document.body.textContent).toContain('Network timeout');
      cleanup2();
    });
  });

  describe('AIEditReviewCard', () => {
    it('renders original vs suggested revision diff and triggers callbacks', () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();

      const { container, cleanup } = renderIntoDom(
        <AIEditReviewCard
          isOpen={true}
          isLoading={false}
          action="academic"
          originalText="The numbers look pretty nice."
          suggestedText="The quantitative metrics demonstrate statistical significance."
          explanation="Elevated tone to formal academic register."
          changesSummary="Rewrote in scholarly register."
          groundingState="source-grounded"
          sources={[
            {
              paperId: 'p2',
              paperTitle: 'Stats Review',
              authors: 'Fisher',
              year: 1925,
              passageText: 'Data shows...',
              confidence: 1.0,
            },
          ]}
          onAccept={onAccept}
          onReject={onReject}
        />
      );

      expect(document.body.textContent).toContain('Make Academic');
      expect(document.body.textContent).toContain('The numbers look pretty nice.');
      expect(document.body.textContent).toContain('The quantitative metrics demonstrate statistical significance.');
      expect(document.body.textContent).toContain('Elevated tone to formal academic register.');

      const acceptBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Accept Revision')
      );
      acceptBtn?.click();
      expect(onAccept).toHaveBeenCalled();

      cleanup();
    });
  });

  describe('CitationPopover', () => {
    it('renders citation search results and handles keyboard selection', () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();

      const papers = [
        {
          id: 'paper-1',
          title: 'Attention Is All You Need',
          authors: [{ familyName: 'Vaswani', givenName: 'Ashish' }],
          year: 2017,
          extractionStatus: 'ok' as const,
        },
        {
          id: 'paper-2',
          title: 'BERT: Pre-training of Deep Bidirectional Transformers',
          authors: [{ familyName: 'Devlin', givenName: 'Jacob' }],
          year: 2018,
          extractionStatus: 'unverified' as const,
        },
      ];

      const { container, cleanup } = renderIntoDom(
        <CitationPopover
          isOpen={true}
          coords={{ top: 100, left: 100 }}
          query="attention"
          papers={papers}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      expect(document.body.textContent).toContain('Cite Source');
      expect(document.body.textContent).toContain('Vaswani (2017)');
      expect(document.body.textContent).toContain('Attention Is All You Need');

      // Click on paper 1
      const option = document.querySelector('#citation-option-paper-1') as HTMLElement;
      expect(option).not.toBeNull();
      option?.click();
      expect(onSelect).toHaveBeenCalledWith(papers[0]);

      cleanup();
    });

    it('renders empty state when no papers match', () => {
      const onOpenAddByIdentifier = vi.fn();
      const { container, cleanup } = renderIntoDom(
        <CitationPopover
          isOpen={true}
          coords={{ top: 50, left: 50 }}
          query="nonexistent"
          papers={[]}
          onSelect={() => {}}
          onClose={() => {}}
          onOpenAddByIdentifier={onOpenAddByIdentifier}
        />
      );

      expect(document.body.textContent).toContain('No matching papers in library.');
      const addBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Add by DOI')
      );
      addBtn?.click();
      expect(onOpenAddByIdentifier).toHaveBeenCalled();

      cleanup();
    });
  });
});
