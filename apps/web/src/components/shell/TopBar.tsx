'use client';

import React from 'react';
import {
  ChevronDown,
  Plus,
  Users,
  User,
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
  saveStatus: SaveStatus;
  isDark: boolean;
  toggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenShortcuts: () => void;
  onOpenNewProject: () => void;
  onOpenTeams: () => void;
  onOpenAccount?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  projects,
  activeProject,
  setActiveProject,
  saveStatus,
  isDark,
  toggleTheme,
  onOpenSearch,
  onOpenShortcuts,
  onOpenNewProject,
  onOpenTeams,
  onOpenAccount = () => {},
}) => {
  return (
    <header className="h-topbar border-b border-border-default bg-surface px-4 flex items-center justify-between shrink-0 select-none z-30">
      {/* Brand & Project Selector */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
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
              <span className="truncate font-medium">{activeProject?.name || t('project.selectProject')}</span>
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
            <DropdownMenuItem
              onClick={onOpenTeams}
              className="text-text-secondary hover:text-text-primary font-medium cursor-pointer text-xs flex items-center space-x-1.5"
            >
              <Users className="w-3.5 h-3.5 text-accent" />
              <span>{t('teams.title')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Global Omnibox Search (center) */}
      <div className="flex-1 max-w-md mx-4 hidden md:block">
        <button
          type="button"
          onClick={onOpenSearch}
          className="w-full flex items-center justify-between px-3 py-1.5 min-h-[32px] text-xs rounded border border-border-default bg-sunken hover:bg-surface text-text-tertiary hover:text-text-secondary transition-[transform,background-color,border-color,color] duration-150 active:scale-[var(--scale-small)] focus-visible:ring-2 focus-visible:ring-accent"
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

      {/* Right Shell Actions (Save status, theme, user) */}
      <div className="flex items-center space-x-3">
        {/* Autosave Status Indicator */}
        <div className="text-xs text-text-tertiary font-mono hidden sm:flex items-center space-x-1.5">
          {saveStatus === 'saving' && (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-accent" />
              <span>{t('editor.saving')}</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <CheckCircle2 className="w-3 h-3 text-trust-success" />
              <span>{t('editor.saved')}</span>
            </>
          )}
          {saveStatus === 'offline' && (
            <>
              <CloudOff className="w-3 h-3 text-trust-warning" />
              <span>{t('editor.offline')}</span>
            </>
          )}
          {saveStatus === 'unsaved' && (
            <span className="text-text-tertiary italic">Unsaved</span>
          )}
        </div>

        {/* Shortcuts Help Tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenShortcuts}
              className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-border-default hover:bg-sunken text-text-secondary transition-[transform,background-color,color] duration-150 active:scale-90 [@media(hover:hover)]:hover:-translate-y-px hidden sm:flex focus-visible:ring-2 focus-visible:ring-accent"
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
              className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-border-default hover:bg-sunken text-text-secondary transition-[transform,background-color,color] duration-150 active:scale-90 [@media(hover:hover)]:hover:-translate-y-px hidden sm:flex focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}</TooltipContent>
        </Tooltip>

        {/* Account Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenAccount}
              className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded border border-border-default hover:bg-sunken text-text-secondary transition-[transform,background-color,color] duration-150 active:scale-90 [@media(hover:hover)]:hover:-translate-y-px hidden sm:flex focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Account"
            >
              <User className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Account</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
};
