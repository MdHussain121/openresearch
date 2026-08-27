'use client';

import React, { useState } from 'react';
import { Sparkles, Plus, Trash2, BookOpen, RefreshCw, Check } from 'lucide-react';
import type { JSONContent } from '@tiptap/core';
import type { GroundedPassage } from '@openresearch/ai';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useProject } from '../../context/ProjectContext';
import { usePaper } from '../../context/PaperContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@openresearch/ui';

export interface OutlineSectionItem {
  id: string;
  title: string;
  level: number;
  description?: string;
  key_points: string[];
  suggested_passages?: GroundedPassage[];
}

export interface AiOutlineModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTopic?: string;
  onInsertOutline: (structuredJson: JSONContent, plainText: string) => void;
}

export const AiOutlineModal: React.FC<AiOutlineModalProps> = ({
  isOpen,
  onClose,
  initialTopic = '',
  onInsertOutline,
}) => {
  const { activeProject } = useProject();
  const { papers } = usePaper();

  const [topic, setTopic] = useState(initialTopic || '');
  const [researchQuestion, setResearchQuestion] = useState('');
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [sections, setSections] = useState<OutlineSectionItem[]>([]);
  const [estimatedWords, setEstimatedWords] = useState<number>(0);
  const [sources, setSources] = useState<GroundedPassage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeProject || !topic.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await api.ai.outline(activeProject.id, {
        topic: topic.trim(),
        research_question: researchQuestion.trim() || undefined,
        paper_ids: selectedPaperIds.length > 0 ? selectedPaperIds : undefined,
        target_sections_count: 7,
      });

      setSections(res.sections || []);
      setEstimatedWords(res.estimated_word_count || 4500);
      setSources(res.sources || []);
      setHasGenerated(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to generate academic outline'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSectionTitleChange = (id: string, newTitle: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: newTitle } : s))
    );
  };

  const handleAddSection = () => {
    const nextIdx = sections.length + 1;
    const newSec: OutlineSectionItem = {
      id: `custom-${Date.now()}`,
      title: `${nextIdx}. Custom Section Heading`,
      level: 1,
      description: 'Section overview and analytical focus.',
      key_points: ['Key argument or analysis point'],
    };
    setSections([...sections, newSec]);
  };

  const handleDeleteSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  };

  const handleApplyToDocument = () => {
    if (sections.length === 0) return;

    // Convert sections into Tiptap JSON document format
    const contentNodes: JSONContent[] = [];
    let plainText = `# ${topic}\n\n`;

    sections.forEach((sec) => {
      // Heading Node
      contentNodes.push({
        type: 'heading',
        attrs: { level: sec.level || 1 },
        content: [{ type: 'text', text: sec.title }],
      });
      plainText += `## ${sec.title}\n`;

      // Description
      if (sec.description) {
        contentNodes.push({
          type: 'paragraph',
          content: [{ type: 'text', text: sec.description }],
        });
        plainText += `${sec.description}\n\n`;
      }

      // Key points as bullet list
      if (sec.key_points && sec.key_points.length > 0) {
        const listItems: JSONContent[] = sec.key_points.map((pt) => ({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: pt }],
            },
          ],
        }));

        contentNodes.push({
          type: 'bulletList',
          content: listItems,
        });

        sec.key_points.forEach((pt) => {
          plainText += `- ${pt}\n`;
        });
        plainText += '\n';
      }
    });

    const docJson: JSONContent = {
      type: 'doc',
      content: contentNodes,
    };

    onInsertOutline(docJson, plainText);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <DialogHeader className="px-5 py-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded bg-accent/15 text-accent">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="font-semibold text-text-primary text-sm">
                {t('aiWriting.outlineModalTitle')}
              </DialogTitle>
              <DialogDescription className="text-[11px] text-text-tertiary">
                {t('aiWriting.outlineModalSubtitle')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content Area */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {!hasGenerated ? (
            /* Prompt Input Form */
            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-text-secondary font-medium mb-1">
                  {t('aiWriting.topicLabel')} <span className="text-trust-danger">*</span>
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={t('aiWriting.topicPlaceholder')}
                  required
                  className="w-full px-3 py-2 text-xs rounded border border-border-default bg-surface text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-text-secondary font-medium mb-1">
                  {t('aiWriting.researchQuestionLabel')}
                </label>
                <textarea
                  value={researchQuestion}
                  onChange={(e) => setResearchQuestion(e.target.value)}
                  placeholder={t('aiWriting.researchQuestionPlaceholder')}
                  rows={2}
                  className="w-full px-3 py-2 text-xs rounded border border-border-default bg-surface text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              {papers.length > 0 && (
                <div>
                  <label className="block text-text-secondary font-medium mb-1.5 flex items-center justify-between">
                    <span>{t('aiWriting.groundingPapersLabel')}</span>
                    <span className="text-[11px] text-text-tertiary">
                      {selectedPaperIds.length === 0 ? t('aiWriting.allProjectPapers') : `${selectedPaperIds.length} selected`}
                    </span>
                  </label>
                  <div className="max-h-32 overflow-y-auto space-y-1 rounded border border-border-default bg-sunken/30 p-2">
                    {papers.map((p) => {
                      const isChecked = selectedPaperIds.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex items-center space-x-2 py-1 px-1.5 rounded hover:bg-surface/80 cursor-pointer text-[11px] text-text-primary"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPaperIds([...selectedPaperIds, p.id]);
                              } else {
                                setSelectedPaperIds(selectedPaperIds.filter((id) => id !== p.id));
                              }
                            }}
                            className="rounded border-border-default text-accent focus:ring-accent"
                          />
                          <span className="truncate">{p.title}</span>
                          <span className="text-text-tertiary shrink-0">({p.year || 'n.d.'})</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && <p className="text-trust-danger text-xs">{error}</p>}

              <button
                type="submit"
                disabled={isLoading || !topic.trim()}
                className="w-full py-2 rounded bg-accent text-accent-solid-fg hover:bg-accent-hover font-medium flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{t('aiWriting.generatingOutline')}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{t('aiWriting.generateOutline')}</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            /* Generated Outline Editor & Review */
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-border-default">
                <div>
                  <h4 className="font-semibold text-text-primary text-sm">{topic}</h4>
                  <p className="text-[11px] text-text-tertiary">
                    {t('aiWriting.estimatedWords')} ~{estimatedWords} words • {sections.length} sections
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleGenerate()}
                  disabled={isLoading}
                  className="flex items-center space-x-1 px-2.5 py-1 text-xs rounded border border-border-default hover:bg-sunken text-text-secondary transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>{t('aiWriting.regenerate')}</span>
                </button>
              </div>

              {/* Sections List */}
              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                {sections.map((sec) => (
                  <div
                    key={sec.id}
                    className="p-3 rounded border border-border-default bg-surface hover:border-accent/40 transition-colors space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={sec.title}
                        onChange={(e) => handleSectionTitleChange(sec.id, e.target.value)}
                        className="font-semibold text-text-primary text-xs bg-transparent border-b border-transparent hover:border-border-default focus:border-accent focus:outline-none flex-1 py-0.5"
                      />
                      <button
                        type="button"
                        onClick={() => handleDeleteSection(sec.id)}
                        className="p-1 rounded hover:bg-sunken text-text-tertiary hover:text-trust-danger transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                        title={t('aiWriting.deleteSection')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {sec.description && (
                      <p className="text-[11px] text-text-secondary leading-relaxed">{sec.description}</p>
                    )}

                    {sec.key_points && sec.key_points.length > 0 && (
                      <ul className="list-disc list-inside space-y-0.5 text-[11px] text-text-tertiary">
                        {sec.key_points.map((pt, i) => (
                          <li key={i} className="truncate">
                            {pt}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={handleAddSection}
                  className="w-full py-2 rounded border border-dashed border-border-default hover:border-accent hover:text-accent text-text-tertiary flex items-center justify-center space-x-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('aiWriting.addSection')}</span>
                </button>
              </div>

              {/* Grounding Sources */}
              {sources.length > 0 && (
                <div className="p-2.5 rounded bg-sunken/40 border border-border-default/80 text-[11px] space-y-1">
                  <div className="flex items-center space-x-1 font-medium text-text-secondary">
                    <BookOpen className="w-3 h-3 text-accent" />
                    <span>Grounded in Literature:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sources.map((src, i) => (
                      <span
                        key={src.paperId || i}
                        className="px-1.5 py-0.5 rounded bg-surface border border-border-default text-text-secondary truncate max-w-[200px]"
                      >
                        {src.authors} ({src.year || 'n.d.'})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {hasGenerated && (
          <DialogFooter className="px-5 py-3 items-center justify-between">
            <button
              type="button"
              onClick={() => setHasGenerated(false)}
              className="px-3 py-1.5 rounded hover:bg-surface text-text-secondary transition-colors text-xs focus-visible:ring-2 focus-visible:ring-accent"
            >
              Back to Prompt
            </button>

            <button
              type="button"
              onClick={handleApplyToDocument}
              className="px-4 py-1.5 rounded bg-accent text-accent-solid-fg hover:bg-accent-hover font-medium text-xs flex items-center space-x-1.5 transition-colors shadow-2xs focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t('aiWriting.insertIntoDocument')}</span>
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
