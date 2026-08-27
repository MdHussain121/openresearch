'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import CodeBlock from '@tiptap/extension-code-block';
import Placeholder from '@tiptap/extension-placeholder';

import { MathEquation } from '../extensions/math';
import { CitationNode } from '../extensions/citation';
import { TrustMarker } from '../extensions/trustMarker';
import { GhostText } from '../extensions/ghostText';
import { ClaimVerificationMark } from '../extensions/claimVerification';
import { EditorToolbar } from './EditorToolbar';
import { CitationPopover } from './CitationPopover';
import type { AcademicEditorProps, EditorStats } from '../types';
import { BibliographicReference, CitationStyle } from '@openresearch/citations';

export const AcademicEditor: React.FC<AcademicEditorProps> = (props) => {
  const {
    initialContent,
    editable = true,
    placeholder = "Start writing your research paper... (Type '@' to cite, 'Ctrl+/' for AI continuation)",
    citationStyle = 'apa',
    libraryPapers = [],
    enableGhostText = true,
    providerLatencyTier = 'fast',
    autoSaveEnabled = true,
    autoSaveIntervalMs = 15000,
    className = '',
    handlers,
  } = props;

  const onUpdate = props.onUpdate ?? handlers?.onUpdate;
  const onSave = props.onSave ?? handlers?.onSave;
  const onCitationInserted = props.onCitationInserted ?? handlers?.onCitationInserted;
  const onCitationDeleted = props.onCitationDeleted ?? handlers?.onCitationDeleted;
  const onInspectSource = props.onInspectSource ?? handlers?.onInspectSource;
  const onOpenAddByIdentifier = props.onOpenAddByIdentifier ?? handlers?.onOpenAddByIdentifier;
  const onTriggerContinuation = props.onTriggerContinuation ?? handlers?.onTriggerContinuation;
  const onTriggerAIEdit = props.onTriggerAIEdit ?? handlers?.onTriggerAIEdit;
  const onOpenOutlineModal = props.onOpenOutlineModal ?? handlers?.onOpenOutlineModal;
  const onOpenExportModal = props.onOpenExportModal ?? handlers?.onOpenExportModal;
  const onInspectClaim = props.onInspectClaim ?? handlers?.onInspectClaim;
  const onDismissClaim = props.onDismissClaim ?? handlers?.onDismissClaim;
  const onGhostTextRequest = props.onGhostTextRequest ?? handlers?.onGhostTextRequest;
  const onFocusChange = props.onFocusChange ?? handlers?.onFocusChange;

  const ghostTextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onSaveRef = useRef(onSave);
  const onUpdateRef = useRef(onUpdate);
  const onGhostTextRequestRef = useRef(onGhostTextRequest);
  const onTriggerContinuationRef = useRef(onTriggerContinuation);
  const onFocusChangeRef = useRef(onFocusChange);
  const previousCitationIdsRef = useRef<Set<string>>(new Set());
  const pendingSaveRef = useRef<{ json: JSONContent; text: string } | null>(null);
  const autoSaveEnabledRef = useRef(autoSaveEnabled);
  const autoSaveIntervalMsRef = useRef(autoSaveIntervalMs);

  // Citation popover state
  const [isCitationPopoverOpen, setIsCitationPopoverOpen] = useState(false);
  const [citationCoords, setCitationCoords] = useState({ top: 0, left: 0 });
  const [citationQuery, setCitationQuery] = useState('');
  const [atSymbolPos, setAtSymbolPos] = useState<number | null>(null);
  const [paragraphContext, setParagraphContext] = useState('');

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    onGhostTextRequestRef.current = onGhostTextRequest;
  }, [onGhostTextRequest]);

  useEffect(() => {
    onTriggerContinuationRef.current = onTriggerContinuation;
  }, [onTriggerContinuation]);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  useEffect(() => {
    autoSaveEnabledRef.current = autoSaveEnabled;
  }, [autoSaveEnabled]);

  useEffect(() => {
    autoSaveIntervalMsRef.current = autoSaveIntervalMs;
  }, [autoSaveIntervalMs]);

  // Interval-based autosave: persists pending changes every autoSaveIntervalMs
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const intervalId = setInterval(() => {
      const pending = pendingSaveRef.current;
      if (pending && onSaveRef.current) {
        pendingSaveRef.current = null;
        onSaveRef.current(pending.json, pending.text);
      }
    }, autoSaveIntervalMs);
    return () => clearInterval(intervalId);
  }, [autoSaveEnabled, autoSaveIntervalMs]);

  // Flush unsaved changes when the editor unmounts (e.g. switching documents)
  useEffect(() => {
    return () => {
      const pending = pendingSaveRef.current;
      if (pending && onSaveRef.current) {
        onSaveRef.current(pending.json, pending.text);
      }
      pendingSaveRef.current = null;
    };
  }, []);

  const computeStats = (text: string): EditorStats => {
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const characters = trimmed.length;
    const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));
    return { words, characters, readingTimeMinutes };
  };

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-accent underline underline-offset-2 hover:text-accent-hover cursor-pointer',
        },
      }),
      Image.configure({
        inline: true,
        HTMLAttributes: {
          class: 'rounded border border-border-default my-4 max-w-full h-auto',
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse table-auto w-full my-4 border border-border-default',
        },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: {
          class: 'border border-border-default bg-sunken px-3 py-2 text-left font-semibold text-xs text-text-secondary',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-border-default px-3 py-2 text-sm text-text-primary',
        },
      }),
      CodeBlock.configure({
        HTMLAttributes: {
          class: 'rounded bg-sunken border border-border-default p-3 font-mono text-xs my-3 overflow-x-auto text-text-primary',
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty before:text-text-tertiary before:content-[attr(data-placeholder)] before:float-left before:pointer-events-none before:h-0',
      }),
      MathEquation,
      CitationNode,
      TrustMarker,
      ClaimVerificationMark.configure({
        onInspectClaim: (claimId, text, suggestedQuery) => {
          onInspectClaim?.(claimId, text, suggestedQuery);
        },
        onDismissClaim: (claimId) => {
          onDismissClaim?.(claimId);
        },
      }),
      GhostText.configure({
        onInspectSource: (paperId, pageNumber, passage) => {
          onInspectSource?.(paperId, pageNumber, passage);
        },
        onAccept: (text, groundingState, sources) => {
          // When accepted, if source-grounded, attach citation reference
          if (groundingState === 'source-grounded' && sources.length > 0) {
            const src = sources[0];
            const paper = libraryPapers.find((p) => p.paperId === src.paperId || p.id === src.paperId);
            if (paper) {
              onCitationInserted?.(paper);
            }
          }
        },
      }),
    ],
    content: initialContent || '',
    onFocus: () => {
      onFocusChangeRef.current?.(true);
    },
    onBlur: () => {
      onFocusChangeRef.current?.(false);
    },
    editorProps: {
      attributes: {
        class:
          'focus:outline-none min-h-[520px] font-serif text-[17px] leading-[1.6] text-text-primary selection:bg-accent/15 px-1 py-2',
      },
      handleKeyDown: (view, event) => {
        // Handle Ctrl+/ or Cmd+/ for Paragraph Continuation
        if ((event.ctrlKey || event.metaKey) && event.key === '/') {
          event.preventDefault();
          const { selection } = view.state;
          const pos = selection.from;
          const resolved = view.state.doc.resolve(pos);
          const paraText = resolved.parent.textContent || '';
          const prefixText = paraText.slice(0, resolved.parentOffset);

          onTriggerContinuationRef.current?.(prefixText, paraText, 'Section');
          return true;
        }

        // Handle '@' to trigger inline citation search
        if (event.key === '@' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const { selection } = view.state;
          const pos = selection.from;
          const coords = view.coordsAtPos(pos);

          // Get current paragraph text for context ranking
          const resolved = view.state.doc.resolve(pos);
          const paraText = resolved.parent.textContent || '';
          setParagraphContext(paraText);

          setAtSymbolPos(pos);
          setCitationQuery('');
          setCitationCoords({ top: coords.bottom, left: coords.left });
          setIsCitationPopoverOpen(true);
        }

        // Handle typing while citation popover is open
        if (isCitationPopoverOpen) {
          if (event.key === 'Escape') {
            setIsCitationPopoverOpen(false);
            setAtSymbolPos(null);
            return true;
          }
        }

        return false;
      },
    },

    onUpdate: ({ editor: currentEditor }) => {
      const json = currentEditor.getJSON();
      const text = currentEditor.getText();
      const stats = computeStats(text);

      // Detect current citation nodes in document
      const currentCitationIds = new Set<string>();
      currentEditor.state.doc.descendants((node) => {
        if (node.type.name === 'citation' && node.attrs.paperId) {
          currentCitationIds.add(node.attrs.paperId);
        }
      });

      // Check if any citations were removed
      previousCitationIdsRef.current.forEach((oldId) => {
        if (!currentCitationIds.has(oldId)) {
          onCitationDeleted?.(oldId);
        }
      });
      previousCitationIdsRef.current = currentCitationIds;


      // Update query text if citation popover is active
      if (isCitationPopoverOpen && atSymbolPos !== null) {
        const currentPos = currentEditor.state.selection.from;
        const typedText =
          currentPos >= atSymbolPos
            ? currentEditor.state.doc.textBetween(atSymbolPos, currentPos, '\n')
            : '';
        // Keep popover only while the '@' anchor is still intact directly behind the cursor
        if (typedText.startsWith('@') && !typedText.includes('\n')) {
          setCitationQuery(typedText.slice(1));
        } else {
          setIsCitationPopoverOpen(false);
          setAtSymbolPos(null);
          setCitationQuery('');
        }
      }

      if (onUpdateRef.current) {
        onUpdateRef.current(json, text, stats);
      }

      // Debounced Ghost Text Autocomplete Trigger (700ms pause)
      if (enableGhostText && providerLatencyTier === 'fast' && onGhostTextRequestRef.current) {
        if (ghostTextTimeoutRef.current) {
          clearTimeout(ghostTextTimeoutRef.current);
        }
        ghostTextTimeoutRef.current = setTimeout(async () => {
          const selection = currentEditor.state.selection;
          if (selection.empty) {
            const pos = selection.from;
            const resolved = currentEditor.state.doc.resolve(pos);
            const paraText = resolved.parent.textContent || '';
            const prefix = paraText.slice(0, resolved.parentOffset);

            if (prefix.trim().length >= 4) {
              const res = await onGhostTextRequestRef.current?.(prefix, paraText, 'Section');
              if (res && res.text) {
                currentEditor.commands.setGhostText({
                  text: res.text,
                  groundingState: res.groundingState,
                  sources: res.sources,
                });
              }
            }
          }
        }, 700);
      }

      // Track unsaved changes; persisted by the autosave interval or manual save
      if (autoSaveEnabledRef.current && onSaveRef.current) {
        pendingSaveRef.current = { json, text };
      }
    },
  });

  // Handle inserting selected citation from popover
  const handleSelectCitation = useCallback(
    (paper: BibliographicReference) => {
      if (!editor) return;

      const firstAuthor = paper.authors?.[0]?.familyName || 'Author';
      const authorStr = paper.authors?.map((a) => a.familyName).join(', ') || firstAuthor;

      // Replace '@query' with CitationNode
      if (atSymbolPos !== null) {
        const currentPos = editor.state.selection.from;
        editor
          .chain()
          .focus()
          .deleteRange({ from: atSymbolPos, to: currentPos })
          .insertContent({
            type: 'citation',
            attrs: {
              paperId: paper.paperId || paper.id,
              paperTitle: paper.title,
              authors: authorStr,
              year: paper.year || null,
              citationStyle: citationStyle || 'apa',
              index: previousCitationIdsRef.current.size + 1,
              attributionScope: 'sentence',
            },
          })
          .run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'citation',
            attrs: {
              paperId: paper.paperId || paper.id,
              paperTitle: paper.title,
              authors: authorStr,
              year: paper.year || null,
              citationStyle: citationStyle || 'apa',
              index: previousCitationIdsRef.current.size + 1,
              attributionScope: 'sentence',
            },
          })
          .run();
      }

      setIsCitationPopoverOpen(false);
      setAtSymbolPos(null);
      setCitationQuery('');
      onCitationInserted?.(paper);
    },
    [editor, atSymbolPos, citationStyle, onCitationInserted]
  );

  // Synchronize citationStyle changes across all existing citation nodes in the document
  useEffect(() => {
    if (!editor || !citationStyle) return;

    let tr = editor.state.tr;
    let modified = false;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'citation' && node.attrs.citationStyle !== citationStyle) {
        tr = tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          citationStyle,
        });
        modified = true;
      }
    });

    if (modified) {
      editor.view.dispatch(tr);
    }
  }, [editor, citationStyle]);

  // Click listener for inspecting citations and trust markers
  const handleEditorClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const citationEl = target.closest('[data-citation-node]');
      if (citationEl) {
        const paperId = citationEl.getAttribute('data-paper-id');
        const pageNumber = citationEl.getAttribute('data-page-number');
        const passage = citationEl.getAttribute('data-relevant-passage');
        if (paperId && onInspectSource) {
          onInspectSource(paperId, pageNumber ? parseInt(pageNumber, 10) : undefined, passage || undefined);
        }
        return;
      }

      const trustEl = target.closest('[data-trust-marker]');
      if (trustEl) {
        const paperId = trustEl.getAttribute('data-paper-id');
        const pageNumber = trustEl.getAttribute('data-page-number');
        const passage = trustEl.getAttribute('data-passage-text');
        if (paperId && onInspectSource) {
          onInspectSource(paperId, pageNumber ? parseInt(pageNumber, 10) : undefined, passage || undefined);
        }
        return;
      }

      // Clicking anywhere else in the document dismisses the citation popover
      if (isCitationPopoverOpen) {
        setIsCitationPopoverOpen(false);
        setAtSymbolPos(null);
        setCitationQuery('');
      }
    },
    [onInspectSource, isCitationPopoverOpen]
  );

  // Explicit Save Shortcut (Ctrl+S / Cmd+S)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (editor && onSaveRef.current) {
          pendingSaveRef.current = null;
          onSaveRef.current(editor.getJSON(), editor.getText());
        }
      }
    },
    [editor]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (ghostTextTimeoutRef.current) {
        clearTimeout(ghostTextTimeoutRef.current);
      }
    };
  }, [handleKeyDown]);

  // Update content if initialContent changes externally and editor is not focused
  useEffect(() => {
    if (editor && initialContent && !editor.isFocused) {
      const currentJson = JSON.stringify(editor.getJSON());
      const newJson = JSON.stringify(initialContent);
      if (currentJson !== newJson) {
        editor.commands.setContent(initialContent);
      }
    }
  }, [editor, initialContent]);

  const handleToolbarContinuation = useCallback(() => {
    if (!editor) return;
    const { selection } = editor.state;
    const pos = selection.from;
    const resolved = editor.state.doc.resolve(pos);
    const paraText = resolved.parent.textContent || '';
    const prefixText = paraText.slice(0, resolved.parentOffset);
    onTriggerContinuation?.(prefixText, paraText, 'Section');
  }, [editor, onTriggerContinuation]);

  const handleToolbarAIEdit = useCallback(
    (action: any) => {
      if (!editor) return;
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to, ' ');
      if (selectedText.trim()) {
        onTriggerAIEdit?.(selectedText.trim(), action);
      } else {
        const resolved = editor.state.doc.resolve(from);
        const paraText = resolved.parent.textContent || '';
        if (paraText.trim()) {
          onTriggerAIEdit?.(paraText.trim(), action);
        }
      }
    },
    [editor, onTriggerAIEdit]
  );

  return (
    <div className={`flex flex-col w-full bg-surface rounded border border-border-default shadow-sm overflow-hidden relative ${className}`}>
      <EditorToolbar
        editor={editor}
        onTriggerContinuation={handleToolbarContinuation}
        onTriggerAIEdit={handleToolbarAIEdit}
        onOpenOutlineModal={onOpenOutlineModal}
        onOpenExportModal={onOpenExportModal}
      />

      <div className="p-6 md:p-10 overflow-y-auto" onClick={handleEditorClick}>
        <EditorContent editor={editor} />
      </div>

      {/* @-Triggered Inline Citation Popover */}
      <CitationPopover
        isOpen={isCitationPopoverOpen}
        coords={citationCoords}
        query={citationQuery}
        papers={libraryPapers}
        paragraphContext={paragraphContext}
        onSelect={handleSelectCitation}
        onClose={() => {
          setIsCitationPopoverOpen(false);
          setAtSymbolPos(null);
        }}
        onOpenAddByIdentifier={onOpenAddByIdentifier}
      />
    </div>
  );
};

