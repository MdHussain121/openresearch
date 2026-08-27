'use client';

import React, { useState } from 'react';
import type { Editor } from '@tiptap/react';
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
  Brain
} from 'lucide-react';
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

  if (!editor) {
    return null;
  }

  const hasSelection = !editor.state.selection.empty;

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter URL:', previousUrl);

    if (url === null) {
      return;
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const insertMath = (e: React.FormEvent) => {
    e.preventDefault();
    if (mathLatex.trim()) {
      editor.commands.setMathEquation(mathLatex.trim());
      setMathOpen(false);
      setMathLatex('');
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
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 border-b border-border-default bg-surface/95 px-3 py-1.5 backdrop-blur-sm text-text-secondary text-xs">
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
              title="AI Writing & Rewrite Actions"
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={setLink}
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                editor.isActive('link')
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Insert Link"
            >
              <LinkIcon className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Insert Link</TooltipContent>
        </Tooltip>

        {/* Math equation popover */}
        <Popover open={mathOpen} onOpenChange={setMathOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`p-1.5 min-h-[30px] min-w-[30px] flex items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                mathOpen
                  ? 'bg-sunken text-accent'
                  : 'hover:bg-sunken hover:text-text-primary'
              }`}
              aria-label="Insert Math Equation (LaTeX)"
            >
              <Sigma className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3 space-y-2">
            <div className="text-[11px] font-semibold text-text-secondary">Insert LaTeX Equation</div>
            <form onSubmit={insertMath} className="space-y-2">
              <input
                type="text"
                value={mathLatex}
                onChange={(e) => setMathLatex(e.target.value)}
                placeholder="e.g. \int_{0}^{\infty} e^{-x^2} dx"
                className="w-full px-2 py-1 text-xs rounded border border-border-default bg-sunken font-mono text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                autoFocus
              />
              <div className="flex justify-end space-x-1.5">
                <button
                  type="button"
                  onClick={() => setMathOpen(false)}
                  className="px-2 py-1 text-[11px] rounded border border-border-default hover:bg-sunken text-text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-2 py-1 text-[11px] rounded bg-accent text-white hover:bg-accent-hover font-medium focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Insert
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
          <button
            type="button"
            onClick={onOpenExportModal}
            className="flex items-center space-x-1.5 px-2.5 py-1 min-h-[30px] rounded bg-accent/10 hover:bg-accent/20 text-accent font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent"
            title="Export Paper (Ctrl+E)"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="font-sans text-xs">Export</span>
          </button>
        </div>
      )}
    </div>
  );
};
