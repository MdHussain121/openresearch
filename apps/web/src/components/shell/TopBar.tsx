'use client';

import React from 'react';
import {
  ChevronDown,
  Plus,
  Search,
  Loader2,
  CheckCircle2,
  CloudOff,
  Keyboard,
  Sun,
  Moon,
  Check,
} from 'lucide-react';
import { t } from '../../i18n';
import { SaveStatus } from '../../context/DocumentContext';
import { useDesktop } from '../../hooks/useDesktop';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@openresearch/ui';

interface TopBarProps {
  projects: any[];
  activeProject: any;
  setActiveProject: (proj: any) => void;
  activeDocumentTitle?: string;
  saveStatus: SaveStatus;
  isDark: boolean;
  toggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenShortcuts: () => void;
  onOpenNewProject: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  projects,
  activeProject,
  setActiveProject,
  activeDocumentTitle,
  saveStatus,
  isDark,
  toggleTheme,
  onOpenSearch,
  onOpenShortcuts,
  onOpenNewProject,
}) => {
  const { isElectron, isMaximized, platform, minimize, toggleMaximize, close } = useDesktop();
  const isMac = platform === 'darwin';

  return (
    <header
      className={`h-topbar border-b border-border-default bg-surface ${
        isElectron && isMac ? 'pl-20 pr-4' : 'px-4'
      } ${
        isElectron && !isMac ? 'pr-0' : ''
      } grid grid-cols-[auto_minmax(0,28rem)_auto] items-center gap-4 shrink-0 select-none z-30 app-drag`}
      onDoubleClick={isElectron ? toggleMaximize : undefined}
    >
      {/* Brand & Project Selector */}
      <div className="flex items-center space-x-3 min-w-0 app-no-drag">
        <div className="flex items-center space-x-2 shrink-0">
          <svg
            viewBox="0 0 64 64"
            className="w-5 h-5 shrink-0"
            role="img"
            aria-label="OpenResearch"
          >
            <rect width="64" height="64" rx="14.5" className="fill-accent" />
            <path
              d="M23.38 37.73 A11.25 11.25 0 1 1 40.62 37.73 M40.62 37.73 L40.62 46.5 L45.62 46.5 M23.38 37.73 L23.38 46.5 L18.38 46.5"
              fill="none"
              strokeWidth="6.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="stroke-[var(--bg-surface)]"
            />
          </svg>
          <span className="font-serif font-bold text-sm tracking-tight text-text-primary hidden sm:inline">
            OpenResearch
          </span>
        </div>

        <span className="text-border-default">/</span>

        {/* Project Switcher Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center space-x-1.5 px-2.5 py-1 min-h-[32px] text-xs rounded border border-border-default hover:bg-sunken text-text-primary transition-[transform,background-color,border-color] duration-150 active:scale-[var(--scale-small)] [@media(hover:hover)]:hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="truncate font-medium max-w-[140px]">{activeProject?.name || t('project.selectProject')}</span>
              <ChevronDown className="w-3 h-3 text-text-tertiary shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="px-3 py-1.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
              {t('project.projects')}
            </DropdownMenuLabel>
            <div className="max-h-48 overflow-y-auto">
              {projects.map((proj) => (
                <DropdownMenuItem
                  key={proj.id}
                  onClick={() => setActiveProject(proj)}
                  className={`flex items-center justify-between text-xs cursor-pointer ${
                    activeProject?.id === proj.id ? 'font-semibold text-accent bg-accent/5' : 'text-text-primary'
                  }`}
                >
                  <span className="truncate">{proj.name}</span>
                  {activeProject?.id === proj.id && <Check className="w-3.5 h-3.5" />}
                </DropdownMenuItem>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onOpenNewProject}
              className="text-accent font-medium cursor-pointer text-xs flex items-center space-x-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('project.newProject')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {activeDocumentTitle && (
          <>
            <span className="text-border-default hidden lg:inline">/</span>
            <span className="text-xs text-text-secondary truncate font-medium max-w-[180px] hidden lg:inline" title={activeDocumentTitle}>
              {activeDocumentTitle}
            </span>
          </>
        )}
      </div>

      {/* Global Omnibox Search (center) */}
      <div className="hidden md:flex justify-center min-w-0 app-no-drag">
        <button
          type="button"
          onClick={onOpenSearch}
          className="w-full max-w-md flex items-center justify-between px-3 py-1.5 min-h-[32px] text-xs rounded border border-border-default bg-sunken hover:bg-surface text-text-tertiary hover:text-text-secondary transition-[transform,background-color,border-color,color] duration-150 active:scale-[var(--scale-small)] focus-visible:ring-2 focus-visible:ring-accent"
        >
          <div className="flex items-center space-x-2">
            <Search className="w-3.5 h-3.5" />
            <span>{t('app.searchPlaceholder')}</span>
          </div>
          <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border-default bg-surface text-text-tertiary">
            Ctrl+K
          </kbd>
        </button>
      </div>

      {/* Right Shell Actions (Save status, theme, search, window controls) */}
      <div className="flex items-center justify-end space-x-2 sm:space-x-3 min-w-0 h-full">
        {/* Autosave Status Indicator — fixed width to prevent search bar shift */}
        <div className="hidden sm:flex items-center justify-end gap-1.5 w-[88px] shrink-0 text-xs text-text-tertiary font-mono tabular-nums">
          {saveStatus === 'saving' && (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-accent shrink-0" />
              <span>{t('editor.saving')}</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <CheckCircle2 className="w-3 h-3 text-trust-success shrink-0" />
              <span>{t('editor.saved')}</span>
            </>
          )}
          {saveStatus === 'offline' && (
            <>
              <CloudOff className="w-3 h-3 text-trust-warning shrink-0" />
              <span>{t('editor.offline')}</span>
            </>
          )}
          {saveStatus === 'unsaved' && (
            <span className="text-text-tertiary italic">Unsaved</span>
          )}
        </div>

        {/* Mobile Search Button */}
        <button
          type="button"
          onClick={onOpenSearch}
          className="md:hidden p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-border-default hover:bg-sunken text-text-secondary transition-[transform,background-color,color] duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-accent app-no-drag"
          aria-label={t('app.searchPlaceholder')}
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Shortcuts Help Tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenShortcuts}
              className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-border-default hover:bg-sunken text-text-secondary transition-[transform,background-color,color] duration-150 active:scale-90 [@media(hover:hover)]:hover:-translate-y-px hidden sm:flex focus-visible:ring-2 focus-visible:ring-accent app-no-drag"
              aria-label={t('shortcuts.title')}
            >
              <Keyboard className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('shortcuts.title')}</TooltipContent>
        </Tooltip>

        {/* Theme Toggle Tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-border-default hover:bg-sunken text-text-secondary transition-[transform,background-color,color] duration-150 active:scale-90 [@media(hover:hover)]:hover:-translate-y-px flex focus-visible:ring-2 focus-visible:ring-accent app-no-drag"
              aria-label={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}</TooltipContent>
        </Tooltip>

        {/* Electron Window Controls (Minimize / Maximize / Close) */}
        {isElectron && !isMac && (
          <div className="flex items-center h-full ml-1 pl-2 border-l border-border-default/70 app-no-drag">
            {/* Minimize */}
            <button
              type="button"
              onClick={minimize}
              className="w-11 h-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-sunken active:bg-sunken/80 transition-colors focus:outline-none"
              title="Minimize"
              aria-label="Minimize"
            >
              <svg width="10" height="1" viewBox="0 0 10 1">
                <rect width="10" height="1" fill="currentColor" />
              </svg>
            </button>

            {/* Maximize / Restore */}
            <button
              type="button"
              onClick={toggleMaximize}
              className="w-11 h-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-sunken active:bg-sunken/80 transition-colors focus:outline-none"
              title={isMaximized ? 'Restore' : 'Maximize'}
              aria-label={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="2" y="0" width="8" height="8" stroke="currentColor" strokeWidth="1" />
                  <path d="M0 2h6v6H0z" fill="var(--bg-surface)" />
                  <rect x="0" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
                </svg>
              )}
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={close}
              className="w-11 h-full flex items-center justify-center text-text-secondary hover:text-white hover:bg-[#E81123] active:bg-[#B80F1D] transition-colors focus:outline-none"
              title="Close"
              aria-label="Close"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 1L9 9M9 1L1 9"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
