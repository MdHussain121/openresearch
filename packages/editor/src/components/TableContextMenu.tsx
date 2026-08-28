'use client';

import React, { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Rows,
  Columns,
  ArrowDown,
  ArrowUp,
  Trash2,
  Plus,
  Combine,
  Table as TableIcon,
} from 'lucide-react';

interface TableContextMenuProps {
  editor: Editor | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onInsertParagraphAfter: () => void;
  onInsertParagraphBefore: () => void;
}

export const TableContextMenu: React.FC<TableContextMenuProps> = ({
  editor,
  position,
  onClose,
  onInsertParagraphAfter,
  onInsertParagraphBefore,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;

    const handlePointerDownOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleScroll = () => {
      onClose();
    };

    window.addEventListener('mousedown', handlePointerDownOutside, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('mousedown', handlePointerDownOutside, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [position, onClose]);

  if (!position || !editor) return null;

  // Calculate clamped viewport positions
  const menuWidth = 220;
  const menuHeight = 360;
  const clampedX = typeof window !== 'undefined' ? Math.max(10, Math.min(position.x, window.innerWidth - menuWidth - 10)) : position.x;
  const clampedY = typeof window !== 'undefined' ? Math.max(10, Math.min(position.y, window.innerHeight - menuHeight - 10)) : position.y;

  const runAction = (fn: () => void) => {
    fn();
    onClose();
    editor.commands.focus();
  };

  return (
    <div
      ref={menuRef}
      style={{ left: `${clampedX}px`, top: `${clampedY}px` }}
      className="fixed z-50 w-56 rounded-lg border border-border-default bg-surface/95 p-1 shadow-2xl backdrop-blur-md text-xs text-text-primary animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      <div className="px-2.5 py-1 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider border-b border-border-default/60 flex items-center justify-between mb-1">
        <span className="flex items-center gap-1">
          <TableIcon className="w-3 h-3 text-accent" />
          <span>Table Options</span>
        </span>
      </div>

      {/* Row Operations */}
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => runAction(() => editor.chain().focus().addRowBefore().run())}
          className="flex items-center w-full px-2 py-1.5 rounded hover:bg-sunken text-left transition-colors cursor-pointer"
        >
          <Rows className="w-3.5 h-3.5 mr-2 text-accent" />
          <span>Insert Row Above</span>
        </button>
        <button
          type="button"
          onClick={() => runAction(() => editor.chain().focus().addRowAfter().run())}
          className="flex items-center w-full px-2 py-1.5 rounded hover:bg-sunken text-left transition-colors cursor-pointer"
        >
          <Rows className="w-3.5 h-3.5 mr-2 text-accent" />
          <span>Insert Row Below</span>
        </button>
        <button
          type="button"
          onClick={() => runAction(() => editor.chain().focus().deleteRow().run())}
          className="flex items-center w-full px-2 py-1.5 rounded hover:bg-sunken text-text-secondary hover:text-text-primary text-left transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5 mr-2 text-text-tertiary" />
          <span>Delete Row</span>
        </button>
      </div>

      <div className="my-1 border-t border-border-default/60" />

      {/* Column Operations */}
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => runAction(() => editor.chain().focus().addColumnBefore().run())}
          className="flex items-center w-full px-2 py-1.5 rounded hover:bg-sunken text-left transition-colors cursor-pointer"
        >
          <Columns className="w-3.5 h-3.5 mr-2 text-accent" />
          <span>Insert Column Left</span>
        </button>
        <button
          type="button"
          onClick={() => runAction(() => editor.chain().focus().addColumnAfter().run())}
          className="flex items-center w-full px-2 py-1.5 rounded hover:bg-sunken text-left transition-colors cursor-pointer"
        >
          <Columns className="w-3.5 h-3.5 mr-2 text-accent" />
          <span>Insert Column Right</span>
        </button>
        <button
          type="button"
          onClick={() => runAction(() => editor.chain().focus().deleteColumn().run())}
          className="flex items-center w-full px-2 py-1.5 rounded hover:bg-sunken text-text-secondary hover:text-text-primary text-left transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5 mr-2 text-text-tertiary" />
          <span>Delete Column</span>
        </button>
      </div>

      <div className="my-1 border-t border-border-default/60" />

      {/* Header & Cell Operations */}
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => runAction(() => editor.chain().focus().toggleHeaderRow().run())}
          className="flex items-center w-full px-2 py-1.5 rounded hover:bg-sunken text-left transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 mr-2 text-text-tertiary" />
          <span>Toggle Header Row</span>
        </button>
        <button
          type="button"
          onClick={() => runAction(() => editor.chain().focus().toggleHeaderColumn().run())}
          className="flex items-center w-full px-2 py-1.5 rounded hover:bg-sunken text-left transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 mr-2 text-text-tertiary" />
          <span>Toggle Header Column</span>
        </button>
        <button
          type="button"
          onClick={() => runAction(() => editor.chain().focus().mergeOrSplit().run())}
          className="flex items-center w-full px-2 py-1.5 rounded hover:bg-sunken text-left transition-colors cursor-pointer"
        >
          <Combine className="w-3.5 h-3.5 mr-2 text-text-tertiary" />
          <span>Merge / Split Cell</span>
        </button>
      </div>

      <div className="my-1 border-t border-border-default/60" />

      {/* Document Navigation Operations */}
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => runAction(onInsertParagraphAfter)}
          className="flex items-center justify-between w-full px-2 py-1.5 rounded bg-accent/10 hover:bg-accent/20 text-accent font-medium text-left transition-colors cursor-pointer"
        >
          <span className="flex items-center">
            <ArrowDown className="w-3.5 h-3.5 mr-2" />
            <span>Write Line Below</span>
          </span>
          <kbd className="text-[9px] font-mono px-1 py-0.2 rounded bg-surface border border-border-default text-text-tertiary">Ctrl+Enter</kbd>
        </button>
        <button
          type="button"
          onClick={() => runAction(onInsertParagraphBefore)}
          className="flex items-center w-full px-2 py-1.5 rounded hover:bg-sunken text-left transition-colors cursor-pointer"
        >
          <ArrowUp className="w-3.5 h-3.5 mr-2 text-text-secondary" />
          <span>Write Line Above</span>
        </button>
      </div>

      <div className="my-1 border-t border-border-default/60" />

      {/* Delete Table */}
      <button
        type="button"
        onClick={() => runAction(() => editor.chain().focus().deleteTable().run())}
        className="flex items-center w-full px-2 py-1.5 rounded hover:bg-trust-danger/10 text-trust-danger text-left transition-colors cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5 mr-2" />
        <span>Delete Entire Table</span>
      </button>
    </div>
  );
};
