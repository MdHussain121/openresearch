'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { Editor } from '@tiptap/react';
import katex from 'katex';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
  FileCode,
  Table as TableIcon,
  Link as LinkIcon,
  Sigma,
  Undo,
  Redo,
  Heading1,
  Heading2,
  Heading3,
  Plus,
  Minus,
  Trash2,
  Columns,
  Rows,
  Sparkles,
  Wand2,
  FileText,
  ChevronDown,
  Download,
  GraduationCap,
  Lightbulb,
  Scissors,
  Search,
  Waves,
  Languages,
  Brain,
  Type,
  ArrowDown,
  ArrowUp
} from 'lucide-react';
import { TextSelection } from '@tiptap/pm/state';
import { AIEditActionType } from '@openresearch/ai';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@openresearch/ui';

const FONT_SIZES = [
  { label: 'Default', value: '' },
  { label: '9px', value: '9px' },
  { label: '10px', value: '10px' },
  { label: '11px', value: '11px' },
  { label: '12px', value: '12px' },
  { label: '13px', value: '13px' },
  { label: '14px', value: '14px' },
  { label: '15px', value: '15px' },
  { label: '16px', value: '16px' },
  { label: '18px', value: '18px' },
  { label: '20px', value: '20px' },
  { label: '22px', value: '22px' },
  { label: '24px', value: '24px' },
  { label: '28px', value: '28px' },
  { label: '32px', value: '32px' },
  { label: '36px', value: '36px' },
  { label: '48px', value: '48px' },
  { label: '72px', value: '72px' },
];

interface EditorToolbarProps {
  editor: Editor | null;
  onTriggerContinuation?: () => void;
  onTriggerAIEdit?: (action: AIEditActionType) => void;
  onOpenOutlineModal?: () => void;
  onOpenExportModal?: () => void;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  editor,
  onTriggerContinuation,
  onTriggerAIEdit,
  onOpenOutlineModal,
  onOpenExportModal,
}) => {
  const [mathOpen, setMathOpen] = useState(false);
  const [mathLatex, setMathLatex] = useState('E = mc^2');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [linkError, setLinkError] = useState('');
  const [customFontSizeInput, setCustomFontSizeInput] = useState('');
  const [fontSizeMenuOpen, setFontSizeMenuOpen] = useState(false);
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null);

  const mathRenderedHtml = useMemo(() => {
    if (!mathLatex.trim()) return '';
    try {
      return katex.renderToString(mathLatex.trim(), {
        throwOnError: false,
        displayMode: true,
      });
    } catch {
      return '';
    }
  }, [mathLatex]);

  useEffect(() => {
    if (!editor) return;
    const updateSelection = () => {
      const { from, to, empty } = editor.state.selection;
      if (!empty && from !== to) {
        lastSelectionRef.current = { from, to };
      }
    };
    editor.on('selectionUpdate', updateSelection);
    return () => {
      editor.off('selectionUpdate', updateSelection);
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  const hasSelection = !editor.state.selection.empty;
  const currentFontSize =
    (editor.schema.marks.textStyle ? (editor.getAttributes('textStyle')?.fontSize as string) : '') ||
    (editor.schema.marks.fontSize ? (editor.getAttributes('fontSize')?.size as string) : '') ||
    '';

  const applyFontSize = (sizeValue: string) => {
    if (!editor) return;

    const currentSel = editor.state.selection;
    const targetSel =
      !currentSel.empty && currentSel.from !== currentSel.to
        ? { from: currentSel.from, to: currentSel.to }
        : lastSelectionRef.current;

    let chain = editor.chain().focus();
    if (targetSel && targetSel.from !== targetSel.to) {
      chain = chain.setTextSelection({ from: targetSel.from, to: targetSel.to });
    }

    if (sizeValue) {
      if (typeof (chain as any).setFontSize === 'function') {
        try {
          (chain as any).setFontSize(sizeValue).run();
          return;
        } catch {}
      }
      if (editor.schema.marks.textStyle) {
        try {
          chain.setMark('textStyle', { fontSize: sizeValue }).run();
          return;
        } catch {}
      }
      if (editor.schema.marks.fontSize) {
        try {
          chain.setMark('fontSize', { size: sizeValue }).run();
          return;
        } catch {}
      }
    } else {
      if (typeof (chain as any).unsetFontSize === 'function') {
        try {
          (chain as any).unsetFontSize().run();
          return;
        } catch {}
      }
      if (editor.schema.marks.textStyle) {
        try {
          chain.setMark('textStyle', { fontSize: null }).run();
          return;
        } catch {}
      }
      if (editor.schema.marks.fontSize) {
        try {
          chain.unsetMark('fontSize').run();
          return;
        } catch {}
      }
    }
  };

  const handleStepFontSize = (delta: number) => {
    if (!editor) return;
    const currentNum = parseInt(currentFontSize, 10) || 16;
    const newNum = Math.max(6, Math.min(144, currentNum + delta));
    applyFontSize(`${newNum}px`);
  };

  const handleCustomFontSizeSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = customFontSizeInput.trim();
    if (!trimmed) {
      applyFontSize('');
      setFontSizeMenuOpen(false);
      return;
    }
    const num = parseFloat(trimmed);
    if (!isNaN(num) && num > 0) {
      applyFontSize(`${num}px`);
      setFontSizeMenuOpen(false);
      setCustomFontSizeInput('');
    }
  };

  const openLinkBox = () => {
    const { from, to, empty } = editor.state.selection;
    if (!empty && from !== to) {
      lastSelectionRef.current = { from, to };
      const selected = editor.state.doc.textBetween(from, to, ' ');
      setLinkText(selected);
    } else {
      setLinkText('');
    }
    const previousUrl: string = editor.getAttributes('link').href || '';
    setLinkUrl(previousUrl);
    setLinkError('');
    setLinkOpen(true);
  };

  const handleLinkSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = linkUrl.trim();
    if (trimmed === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setLinkOpen(false);
      setLinkUrl('');
      setLinkText('');
      return;
    }
    // Validate URL — allow absolute with protocol, protocol-relative, mailto, or path
    const isValid = (() => {
      try {
        if (/^(https?:\/\/|mailto:|tel:|#|\/)/i.test(trimmed)) {
          new URL(trimmed, 'https://example.com');
          return true;
        }
        new URL(trimmed, 'https://example.com');
        return true;
      } catch {
        return false;
      }
    })();
    if (!isValid) {
      setLinkError('Enter a valid URL (e.g. https://example.com)');
      return;
    }
    // Auto-prefix https:// for bare domains
    const href = /^(https?:\/\/|mailto:|tel:|#|\/)/i.test(trimmed) ? trimmed : `https://${trimmed}`;

    const targetSel = lastSelectionRef.current;
    const currentSel = editor.state.selection;
    const effectiveSel = (!currentSel.empty && currentSel.from !== currentSel.to) ? currentSel : targetSel;

    if (effectiveSel && effectiveSel.from !== effectiveSel.to) {
      editor
        .chain()
        .focus()
        .setTextSelection({ from: effectiveSel.from, to: effectiveSel.to })
        .setLink({ href })
        .run();
    } else if (editor.isActive('link')) {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href })
        .run();
    } else {
      // If no text was selected, insert as linked text
      const displayText = linkText.trim() || href;
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: displayText,
          marks: [{ type: 'link', attrs: { href } }],
        })
        .run();
    }

    setLinkOpen(false);
    setLinkUrl('');
    setLinkText('');
  };

  const handleLinkRemove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
    setLinkUrl('');
    setLinkText('');
  };

  const insertMath = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (mathLatex.trim()) {
      editor.chain().focus().setMathEquation(mathLatex.trim()).run();
      setMathOpen(false);
    }
  };

  const aiEditActions: Array<{ action: AIEditActionType; label: string; icon: React.ReactNode }> = [
    { action: 'clarity', label: 'Improve Clarity', icon: <Sparkles className="w-3.5 h-3.5 text-accent" /> },
    { action: 'academic', label: 'Make Academic', icon: <GraduationCap className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" /> },
    { action: 'simplify', label: 'Simplify Text', icon: <Lightbulb className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> },
    { action: 'shorten', label: 'Shorten & Condense', icon: <Scissors className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" /> },
    { action: 'expand', label: 'Expand & Elaborate', icon: <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> },
    { action: 'grammar', label: 'Fix Grammar & Style', icon: <Search className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" /> },
    { action: 'flow', label: 'Improve Flow & Transitions', icon: <Waves className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" /> },
    { action: 'translate', label: 'Translate Language', icon: <Languages className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> },
    { action: 'explain', label: 'Explain Selected Passage', icon: <Brain className="w-3.5 h-3.5 text-pink-600 dark:text-pink-400" /> },
  ];

  return (
    <div className="sticky top-0 z-30 flex flex-wrap items-center gap-1 border-b border-border-default bg-surface px-3 py-1.5 backdrop-blur-sm text-text-secondary text-xs rounded-t shadow-xs">
      {/* AI Writing Actions Group (Phase 6) */}
      <div className="flex items-center space-x-1 border-r border-border-default pr-1.5 mr-1">
        {/* AI Rewrite Actions Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`flex items-center space-x-1.5 px-2 py-1 min-h-[30px] rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                hasSelection
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'hover:bg-sunken hover:text-text-primary text-text-secondary'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              <span>AI Edit</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {hasSelection ? 'Transform Selected Text' : 'Select text in editor first'}
            </DropdownMenuLabel>
            <div className="max-h-60 overflow-y-auto">
              {aiEditActions.map((item) => (
                <DropdownMenuItem
                  key={item.action}
                  onClick={() => onTriggerAIEdit?.(item.action)}
                  className="flex items-center space-x-2 text-text-primary text-xs cursor-pointer"
                >
                  {item.icon}
                  <span>{item.label}</span>
                </DropdownMenuItem>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* AI Paragraph Continuation (Ctrl+/) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onTriggerContinuation}
              className="flex items-center space-x-1 px-2 py-1 min-h-[30px] rounded hover:bg-sunken hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="AI Continuation (Ctrl+/)"
            >
              <Wand2 className="w-3.5 h-3.5 text-accent" />
              <span className="hidden sm:inline">Continue</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>AI Continuation (Ctrl+/)</TooltipContent>
        </Tooltip>

        {/* AI Outline Generator */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenOutlineModal}
              className="flex items-center space-x-1 px-2 py-1 min-h-[30px] rounded hover:bg-sunken hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="AI Outline Generator"
            >
              <FileText className="w-3.5 h-3.5 text-accent" />
              <span className="hidden sm:inline">Outline</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>AI Outline Generator</TooltipContent>
        </Tooltip>
      </div>

      {/* Heading / Style Selector */}
      <div className="flex items-center space-x-0.5 border-r border-border-default pr-1.5 mr-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().setParagraph().run()}
              className={`px-2 py-1 min-h-[30px] rounded font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('paragraph') && !editor.isActive('heading')
                  ? 'bg-sunken text-accent font-semibold'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Normal Text"
            >
              P
            </button>
          </TooltipTrigger>
          <TooltipContent>Normal Text</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('heading', { level: 1 })
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Heading 1"
            >
              <Heading1 className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Heading 1</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('heading', { level: 2 })
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Heading 2"
            >
              <Heading2 className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Heading 2</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('heading', { level: 3 })
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Heading 3"
            >
              <Heading3 className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Heading 3</TooltipContent>
        </Tooltip>

        {/* Font Size Selector: [-] [Value/Dropdown] [+] */}
        <div className="flex items-center space-x-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (editor) {
                    const { from, to, empty } = editor.state.selection;
                    if (!empty && from !== to) {
                      lastSelectionRef.current = { from, to };
                    }
                  }
                }}
                onClick={() => handleStepFontSize(-1)}
                className="p-1 min-h-[28px] min-w-[28px] flex items-center justify-center rounded hover:bg-sunken hover:text-text-primary text-text-secondary transition-colors"
                aria-label="Decrease Font Size"
              >
                <Minus className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Decrease font size</TooltipContent>
          </Tooltip>

          <DropdownMenu open={fontSizeMenuOpen} onOpenChange={setFontSizeMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onMouseDown={() => {
                  if (editor) {
                    const { from, to, empty } = editor.state.selection;
                    if (!empty && from !== to) {
                      lastSelectionRef.current = { from, to };
                    }
                  }
                }}
                className={`flex items-center justify-between space-x-1 px-2 py-0.5 min-h-[28px] min-w-[58px] rounded border border-border-default transition-colors text-xs font-mono focus-visible:ring-2 focus-visible:ring-accent ${
                  currentFontSize ? 'bg-sunken text-accent font-semibold' : 'bg-surface hover:bg-sunken hover:text-text-primary'
                }`}
                aria-label="Font Size"
              >
                <span>{currentFontSize ? currentFontSize.replace('px', '') : '16'}</span>
                <ChevronDown className="w-2.5 h-2.5 opacity-60 ml-1" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44 text-xs p-1">
              <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Font Size
              </DropdownMenuLabel>

              {/* Custom Size Form */}
              <div className="p-1 mb-1 border-b border-border-default">
                <form onSubmit={handleCustomFontSizeSubmit} className="flex items-center space-x-1">
                  <input
                    type="number"
                    min="6"
                    max="144"
                    value={customFontSizeInput}
                    onChange={(e) => setCustomFontSizeInput(e.target.value)}
                    placeholder="Custom px"
                    className="w-full px-2 py-1 text-xs bg-bg-sunken border border-border-default rounded text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    type="submit"
                    className="px-2 py-1 text-xs font-medium bg-accent text-accent-solid-fg rounded hover:bg-accent/90 shrink-0"
                  >
                    Set
                  </button>
                </form>
              </div>

              <div className="max-h-56 overflow-y-auto">
                {FONT_SIZES.map((size) => (
                  <DropdownMenuItem
                    key={size.value || 'default'}
                    onClick={() => {
                      applyFontSize(size.value);
                      setFontSizeMenuOpen(false);
                    }}
                    className={`cursor-pointer flex items-center justify-between text-xs px-2 py-1.5 rounded ${
                      currentFontSize === size.value ? 'bg-accent/10 text-accent font-medium' : 'text-text-primary'
                    }`}
                  >
                    <span>{size.label}</span>
                    {currentFontSize === size.value && <span className="text-[10px] text-accent">✓</span>}
                  </DropdownMenuItem>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (editor) {
                    const { from, to, empty } = editor.state.selection;
                    if (!empty && from !== to) {
                      lastSelectionRef.current = { from, to };
                    }
                  }
                }}
                onClick={() => handleStepFontSize(1)}
                className="p-1 min-h-[28px] min-w-[28px] flex items-center justify-center rounded hover:bg-sunken hover:text-text-primary text-text-secondary transition-colors"
                aria-label="Increase Font Size"
              >
                <Plus className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Increase font size</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Inline Marks */}
      <div className="flex items-center space-x-0.5 border-r border-border-default pr-1.5 mr-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('bold')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Bold (Ctrl+B)"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Bold (Ctrl+B)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('italic')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Italic (Ctrl+I)"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Italic (Ctrl+I)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('underline')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Underline (Ctrl+U)"
            >
              <UnderlineIcon className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Underline (Ctrl+U)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('strike')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Strikethrough"
            >
              <Strikethrough className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Strikethrough</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('code')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Inline Code"
            >
              <Code className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Inline Code</TooltipContent>
        </Tooltip>
      </div>

      {/* Lists & Quotes */}
      <div className="flex items-center space-x-0.5 border-r border-border-default pr-1.5 mr-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('bulletList')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Bullet List"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Bullet List</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('orderedList')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Ordered List"
            >
              <ListOrdered className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Ordered List</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('blockquote')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Block Quote"
            >
              <Quote className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Block Quote</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('codeBlock')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Code Block"
            >
              <FileCode className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Code Block</TooltipContent>
        </Tooltip>
      </div>

      {/* Advanced Inserts: Table, Link, Math */}
      <div className="flex items-center space-x-0.5 border-r border-border-default pr-1.5 mr-1">
        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={openLinkBox}
                  className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                    editor.isActive('link')
                      ? 'bg-sunken text-accent font-semibold'
                      : 'hover:bg-sunken hover:text-text-primary'
                  }`}
                  aria-label="Insert Link"
                  aria-expanded={linkOpen}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Insert Link</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-80 p-3 space-y-2.5 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-text-primary">
                {editor.isActive('link') ? 'Edit Link' : 'Insert Link'}
              </div>
              {editor.isActive('link') && (
                <button
                  type="button"
                  onClick={handleLinkRemove}
                  className="text-[11px] text-trust-danger hover:underline underline-offset-2"
                >
                  Remove Link
                </button>
              )}
            </div>
            <form onSubmit={handleLinkSubmit} className="space-y-2">
              {!hasSelection && !editor.isActive('link') && (
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-text-secondary">Text to display</label>
                  <input
                    type="text"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    placeholder="e.g. My Reference Source"
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-border-default bg-sunken text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-text-secondary">Destination URL</label>
                <div className="relative">
                  <LinkIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary pointer-events-none" />
                  <input
                    type="text"
                    value={linkUrl}
                    onChange={(e) => {
                      setLinkUrl(e.target.value);
                      if (linkError) setLinkError('');
                    }}
                    placeholder="https://example.com"
                    className="w-full pl-7 pr-2.5 py-1.5 text-xs rounded border border-border-default bg-sunken font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    autoFocus={hasSelection || editor.isActive('link')}
                  />
                </div>
              </div>
              {linkError && <p className="text-[11px] text-trust-danger">{linkError}</p>}
              <div className="flex justify-end space-x-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setLinkOpen(false)}
                  className="px-2.5 py-1.5 text-[11px] rounded border border-border-default hover:bg-sunken text-text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-[11px] rounded bg-accent text-accent-solid-fg hover:bg-accent-hover font-medium focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {linkUrl.trim() === '' ? 'Remove Link' : editor.isActive('link') ? 'Update Link' : 'Insert Link'}
                </button>
              </div>
            </form>
          </PopoverContent>
        </Popover>

        {/* Math equation popover */}
        <Popover open={mathOpen} onOpenChange={setMathOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                    mathOpen
                      ? 'bg-sunken text-accent font-semibold'
                      : 'hover:bg-sunken hover:text-text-primary'
                  }`}
                  aria-label="Insert Math Equation (LaTeX)"
                >
                  <Sigma className="w-3.5 h-3.5" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Insert Math Equation (LaTeX)</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-80 p-3.5 space-y-3 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-text-primary">Insert LaTeX Equation</div>
              <span className="text-[10px] font-mono text-text-tertiary">KaTeX</span>
            </div>

            <form onSubmit={insertMath} className="space-y-2.5">
              <div className="space-y-1">
                <input
                  type="text"
                  value={mathLatex}
                  onChange={(e) => setMathLatex(e.target.value)}
                  placeholder="e.g. \int_{0}^{\infty} e^{-x^2} dx"
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-border-default bg-sunken font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  autoFocus
                />
              </div>

              {/* Quick Formula Presets */}
              <div className="space-y-1">
                <div className="text-[10px] text-text-tertiary font-medium">Quick templates</div>
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: 'E=mc²', formula: 'E = mc^2' },
                    { label: 'a/b', formula: '\\frac{a}{b}' },
                    { label: '√x', formula: '\\sqrt{x}' },
                    { label: '∑xᵢ', formula: '\\sum_{i=1}^{n} x_i' },
                    { label: '∫f(x)', formula: '\\int_{0}^{\\infty} f(x) dx' },
                    { label: 'α+β', formula: '\\alpha + \\beta = \\gamma' },
                  ].map((tpl) => (
                    <button
                      key={tpl.label}
                      type="button"
                      onClick={() => setMathLatex(tpl.formula)}
                      className="px-1.5 py-0.5 text-[10px] rounded border border-border-default bg-surface hover:bg-sunken text-text-secondary font-mono transition-colors"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live KaTeX Preview Box */}
              {mathRenderedHtml && (
                <div className="p-2.5 rounded bg-sunken border border-border-default flex items-center justify-center min-h-[44px] overflow-x-auto text-sm text-text-primary">
                  <div dangerouslySetInnerHTML={{ __html: mathRenderedHtml }} />
                </div>
              )}

              <div className="flex justify-end space-x-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setMathOpen(false)}
                  className="px-2.5 py-1.5 text-[11px] rounded border border-border-default hover:bg-sunken text-text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!mathLatex.trim()}
                  className="px-3 py-1.5 text-[11px] rounded bg-accent text-accent-solid-fg hover:bg-accent-hover font-medium focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  Insert Equation
                </button>
              </div>
            </form>
          </PopoverContent>
        </Popover>

        {/* Table Operations Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('table')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Table Operations"
            >
              <TableIcon className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48 text-xs">
            {!editor.isActive('table') ? (
              <DropdownMenuItem
                onClick={() => {
                  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                  const { state, dispatch } = editor.view;
                  const { $from } = state.selection;
                  for (let d = $from.depth; d > 0; d--) {
                    if ($from.node(d).type.name === 'table') {
                      const afterPos = $from.after(d);
                      if (afterPos >= state.doc.content.size) {
                        const paragraphNode = state.schema.nodes.paragraph.create();
                        dispatch(state.tr.insert(afterPos, paragraphNode));
                      }
                      break;
                    }
                  }
                }}
                className="cursor-pointer flex items-center space-x-2 text-text-primary text-xs"
              >
                <Plus className="w-3.5 h-3.5 text-accent" />
                <span>Insert Table (3×3)</span>
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem
                  onClick={() => {
                    editor.chain().focus().addRowAfter().run();
                  }}
                  className="cursor-pointer flex items-center space-x-2 text-text-primary text-xs"
                >
                  <Rows className="w-3.5 h-3.5" />
                  <span>Add Row Below</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    editor.chain().focus().addColumnAfter().run();
                  }}
                  className="cursor-pointer flex items-center space-x-2 text-text-primary text-xs"
                >
                  <Columns className="w-3.5 h-3.5" />
                  <span>Add Column Right</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    editor.chain().focus().deleteRow().run();
                  }}
                  className="cursor-pointer flex items-center space-x-2 text-text-secondary text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Row</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    editor.chain().focus().deleteColumn().run();
                  }}
                  className="cursor-pointer flex items-center space-x-2 text-text-secondary text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Column</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    const { state, dispatch } = editor.view;
                    const { $from } = state.selection;
                    for (let d = $from.depth; d > 0; d--) {
                      if ($from.node(d).type.name === 'table') {
                        const afterPos = $from.after(d);
                        const paragraphNode = state.schema.nodes.paragraph.create();
                        const tr = state.tr.insert(afterPos, paragraphNode);
                        const resolvedPos = tr.doc.resolve(afterPos + 1);
                        tr.setSelection(TextSelection.near(resolvedPos));
                        dispatch(tr.scrollIntoView());
                        break;
                      }
                    }
                  }}
                  className="cursor-pointer flex items-center space-x-2 text-text-primary text-xs"
                >
                  <ArrowDown className="w-3.5 h-3.5 text-accent" />
                  <span>Insert Line Below Table (Ctrl+Enter)</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const { state, dispatch } = editor.view;
                    const { $from } = state.selection;
                    for (let d = $from.depth; d > 0; d--) {
                      if ($from.node(d).type.name === 'table') {
                        const beforePos = $from.before(d);
                        const paragraphNode = state.schema.nodes.paragraph.create();
                        const tr = state.tr.insert(beforePos, paragraphNode);
                        const resolvedPos = tr.doc.resolve(beforePos + 1);
                        tr.setSelection(TextSelection.near(resolvedPos));
                        dispatch(tr.scrollIntoView());
                        break;
                      }
                    }
                  }}
                  className="cursor-pointer flex items-center space-x-2 text-text-primary text-xs"
                >
                  <ArrowUp className="w-3.5 h-3.5 text-accent" />
                  <span>Insert Line Above Table</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    editor.chain().focus().deleteTable().run();
                  }}
                  className="cursor-pointer flex items-center space-x-2 text-trust-danger text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Table</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Undo / Redo */}
      <div className="flex items-center space-x-0.5 border-r border-border-default pr-1.5 mr-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              className="p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors hover:bg-sunken hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Undo (Ctrl+Z)"
            >
              <Undo className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
              className="p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors hover:bg-sunken hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Redo (Ctrl+Y)"
            >
              <Redo className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
        </Tooltip>
      </div>

      {/* Export Action (Phase 7.1) */}
      {onOpenExportModal && (
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenExportModal}
                className="flex items-center space-x-1.5 px-2.5 py-1 min-h-[30px] rounded bg-accent/10 hover:bg-accent/20 text-accent font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="font-sans text-xs">Export</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Export Paper (Ctrl+E)</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
};
