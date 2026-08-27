'use client';

import React, { useState } from 'react';
import { t } from '../../i18n';
import { Keyboard, Search, Sparkles, BookOpen, FileText, Settings, Compass } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@openresearch/ui';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  const [filterQuery, setFilterQuery] = useState('');

  const shortcutCategories = [
    {
      name: t('shortcuts.categories.editor'),
      icon: <FileText className="w-3.5 h-3.5 text-accent" />,
      shortcuts: [
        { key: 'Ctrl/Cmd + S', action: t('shortcuts.save') },
        { key: 'Ctrl/Cmd + Z', action: t('shortcuts.undo') },
        { key: 'Ctrl/Cmd + Shift + Z / Y', action: t('shortcuts.redo') },
        { key: 'Ctrl/Cmd + F', action: t('shortcuts.find') },
        { key: 'Ctrl/Cmd + E', action: t('shortcuts.openExport') },
      ],
    },
    {
      name: t('shortcuts.categories.aiWriting'),
      icon: <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />,
      shortcuts: [
        { key: 'Tab', action: t('shortcuts.acceptGhost') },
        { key: 'Ctrl/Cmd + /', action: t('shortcuts.aiContinuation') },
        { key: 'Esc', action: t('shortcuts.dismissGhost') },
      ],
    },
    {
      name: t('shortcuts.categories.citations'),
      icon: <BookOpen className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />,
      shortcuts: [
        { key: '@', action: t('shortcuts.cite') },
        { key: '↑ / ↓  then Enter', action: t('shortcuts.navigateList') },
        { key: 'Ctrl/Cmd + \\', action: t('shortcuts.toggleSourcePanel') },
      ],
    },
    {
      name: t('shortcuts.categories.navigation'),
      icon: <Compass className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />,
      shortcuts: [
        { key: 'Ctrl/Cmd + K', action: t('shortcuts.globalSearch') },
        { key: 'Ctrl/Cmd + Shift + C', action: t('shortcuts.openChat') },
      ],
    },
    {
      name: t('shortcuts.categories.system'),
      icon: <Settings className="w-3.5 h-3.5 text-text-tertiary" />,
      shortcuts: [
        { key: '?', action: t('shortcuts.shortcutsHelp') },
        { key: 'Esc', action: t('shortcuts.pressEsc') },
      ],
    },
  ];

  const q = filterQuery.toLowerCase().trim();
  const filteredCategories = shortcutCategories
    .map((cat) => ({
      ...cat,
      shortcuts: cat.shortcuts.filter(
        (s) => !q || s.action.toLowerCase().includes(q) || s.key.toLowerCase().includes(q)
      ),
    }))
    .filter((cat) => cat.shortcuts.length > 0);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl p-0 flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 py-4">
          <div className="flex items-center space-x-2">
            <Keyboard className="w-5 h-5 text-accent" />
            <div>
              <DialogTitle className="font-serif font-bold text-base text-text-primary">
                {t('shortcuts.title')} (UI/UX §9)
              </DialogTitle>
              <DialogDescription className="text-xs text-text-tertiary">
                {t('shortcuts.subtitle')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Filter input */}
        <div className="px-6 py-2.5 border-b border-border-default/60 bg-sunken/40">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-tertiary absolute left-3 top-2.5" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t('shortcuts.filterPlaceholder')}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded border border-border-default bg-surface text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              autoFocus
            />
          </div>
        </div>

        {/* Content list */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs">
          {filteredCategories.length > 0 ? (
            filteredCategories.map((cat, catIdx) => (
              <div key={catIdx} className="space-y-1.5">
                <div className="flex items-center space-x-1.5 font-semibold text-[11px] uppercase tracking-wider text-text-secondary">
                  {cat.icon}
                  <span>{cat.name}</span>
                </div>
                <div className="divide-y divide-border-default/60 rounded border border-border-default bg-sunken/30">
                  {cat.shortcuts.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between px-3.5 py-2 hover:bg-surface/50 transition-colors">
                      <span className="text-text-primary font-medium">{item.action}</span>
                      <kbd className="px-2 py-0.5 rounded bg-surface border border-border-default font-mono text-[11px] text-text-secondary shadow-2xs">
                        {item.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-6 text-text-tertiary">
              No shortcuts matching &quot;{filterQuery}&quot;
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded bg-accent text-accent-solid-fg font-medium hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent transition-colors"
          >
            {t('common.close')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
