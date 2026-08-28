'use client';

import React, { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  FileText,
  BookOpen,
  Quote,
  Sparkles,
  MessageSquare,
  Plus,
  Trash2,
  Boxes,
  Gauge,
  FolderSync,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
} from 'lucide-react';
import { t } from '../../i18n';
import { Tooltip, TooltipTrigger, TooltipContent } from '@openresearch/ui';
import { ConfirmDialog } from '../modals/ConfirmDialog';
import { useWorkspace, NAV_ROUTES, NavKey } from '../../context/WorkspaceContext';
import { useDocument } from '../../context/DocumentContext';

interface LeftNavigationProps {
  papersCount: number;
  citationStyle: string;
  documents: any[];
  activeDocument: any;
  setActiveDocument: (doc: any) => void;
  createDocument: (title?: string) => void;
  deleteDocument: (id: string) => void;
  onOpenPlugins: () => void;
  onOpenProviderQuota: () => void;
  onOpenZotero: () => void;
}

const NAV_ITEMS: Array<{ nav: NavKey; icon: React.ReactNode; label: string; title: string }> = [
  { nav: 'documents', icon: <FileText className="w-4 h-4 shrink-0" />, label: t('nav.documents'), title: t('nav.documents') },
  { nav: 'library', icon: <BookOpen className="w-4 h-4 shrink-0" />, label: t('nav.library'), title: 'Research Library' },
  { nav: 'citations', icon: <Quote className="w-4 h-4 shrink-0" />, label: t('nav.citations'), title: 'Citations & Bibliography' },
  { nav: 'intelligence', icon: <Sparkles className="w-4 h-4 shrink-0 text-accent" />, label: 'Intelligence', title: 'Research Intelligence (Literature Matrix, Gaps, Review)' },
  { nav: 'aiChat', icon: <MessageSquare className="w-4 h-4 shrink-0" />, label: t('nav.aiChat'), title: 'AI Research Chat' },
  { nav: 'settings', icon: <SettingsIcon className="w-4 h-4 shrink-0" />, label: t('nav.settings'), title: t('settings.title') },
];

export const LeftNavigation: React.FC<LeftNavigationProps> = ({
  papersCount,
  citationStyle,
  documents,
  activeDocument,
  setActiveDocument,
  createDocument,
  deleteDocument,
  onOpenPlugins,
  onOpenProviderQuota,
  onOpenZotero,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const w = useWorkspace();
  const isSidebarCollapsed = w.isSidebarCollapsed;
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  return (
    <aside
      className="border-r border-border-default bg-sunken flex flex-col justify-between shrink-0 contain-layout transition-[width] duration-250 ease-smooth-out overflow-hidden"
      style={{ width: isSidebarCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)' }}
    >
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <div className={`h-full flex flex-col min-h-0 ${isSidebarCollapsed ? 'p-1.5' : 'p-2'}`}>
          {/* Nav Links */}
          <nav className="space-y-1 shrink-0">
            {NAV_ITEMS.map((item, idx) => {
              const isActive = pathname === NAV_ROUTES[item.nav];
              const buttonContent = (
                <button
                  onClick={() => router.push(NAV_ROUTES[item.nav])}
                  style={!isSidebarCollapsed ? { animationDelay: `${Math.min(idx * 40, 240)}ms` } : undefined}
                  className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-0' : 'space-x-3 px-3'} py-2 text-xs rounded transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[var(--scale-small)] ${!isSidebarCollapsed ? 'animate-fade-slide-in' : ''} border-l-2 ${
                    isActive
                      ? 'border-accent text-accent font-medium bg-surface/60'
                      : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface/30'
                  }`}
                  aria-label={item.title}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {!isSidebarCollapsed && (
                    <div className="flex items-center justify-between w-full min-w-0 transition-opacity duration-150" style={{ transitionDelay: '40ms' }}>
                      <span className="truncate">
                        {item.label}
                      </span>
                      {item.nav === 'library' && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface border border-border-default text-text-tertiary shrink-0 ml-1">
                          {papersCount}
                        </span>
                      )}
                      {item.nav === 'citations' && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-surface border border-border-default text-text-tertiary font-mono shrink-0 ml-1">
                          {citationStyle.toUpperCase()}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );

              if (isSidebarCollapsed) {
                return (
                  <Tooltip key={item.nav}>
                    <TooltipTrigger asChild>
                      {buttonContent}
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.title}</TooltipContent>
                  </Tooltip>
                );
              }

              return <React.Fragment key={item.nav}>{buttonContent}</React.Fragment>;
            })}
          </nav>

          {/* Document List Sub-Section - flexible vertical height utilization */}
          {!isSidebarCollapsed && (
            <div className="pt-3 mt-2 border-t border-border-default/60 flex-1 flex flex-col min-h-0 space-y-1.5 animate-in fade-in duration-150" style={{ transitionTimingFunction: 'var(--ease-default)' }}>
              <div className="flex items-center justify-between px-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider shrink-0">
                <span className="flex items-center gap-1.5">
                  <span>{t('document.documents')}</span>
                  {documents.length > 0 && (
                    <span className="text-[10px] font-mono font-normal text-text-tertiary">({documents.length})</span>
                  )}
                </span>
                <button
                  onClick={() => createDocument()}
                  className="p-1 rounded hover:bg-surface text-accent hover:text-accent-hover transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                  title={t('document.newDocument')}
                  aria-label={t('document.newDocument')}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-0.5 flex-1 overflow-y-auto px-1 pr-1 min-h-0">
                {documents.map((doc, idx) => (
                  <button
                    key={doc.id}
                    onClick={() => setActiveDocument(doc)}
                    aria-current={activeDocument?.id === doc.id ? 'page' : undefined}
                    style={{ animationDelay: `${Math.min(idx * 40, 240)}ms` }}
                    className={`group flex items-center justify-between w-full px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-[transform,background-color,color,box-shadow] duration-150 active:scale-[var(--scale-small)] text-left animate-fade-slide-in ${
                      activeDocument?.id === doc.id
                        ? 'bg-surface text-accent font-semibold shadow-2xs'
                        : 'text-text-secondary hover:text-text-primary hover:bg-surface/50 font-normal'
                    }`}
                  >
                    <span className="truncate pr-1 flex-1">{doc.title || t('document.untitled')}</span>
                    {documents.length > 1 && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteId(doc.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setPendingDeleteId(doc.id);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 p-0.5 text-text-tertiary hover:text-trust-danger transition-opacity duration-150 shrink-0"
                        aria-label={t('document.deleteDocument')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar Footer - fixed at bottom */}
      <div className={`border-t border-border-default/60 space-y-1 shrink-0 ${isSidebarCollapsed ? 'p-1.5' : 'px-2 pb-2 pt-2'}`}>
        {/* Plugin Manager Trigger */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenPlugins}
              className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center py-1.5' : 'space-x-2.5 px-3 py-1.5'} text-xs text-text-secondary hover:text-text-primary hover:bg-surface/40 rounded transition-[transform,background-color,color] duration-150 active:scale-[var(--scale-small)]`}
              aria-label={t('plugins.title')}
            >
              <Boxes className="w-3.5 h-3.5 shrink-0 text-accent" />
              {!isSidebarCollapsed && <span>{t('plugins.title')}</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent side={isSidebarCollapsed ? 'right' : 'top'}>Community Plugins</TooltipContent>
        </Tooltip>

        {/* Provider Quota Trigger */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenProviderQuota}
              className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center py-1.5' : 'space-x-2.5 px-3 py-1.5'} text-xs text-text-secondary hover:text-text-primary hover:bg-surface/40 rounded transition-[transform,background-color,color] duration-150 active:scale-[var(--scale-small)]`}
              aria-label={t('providers.status')}
            >
              <Gauge className="w-3.5 h-3.5 shrink-0 text-accent" />
              {!isSidebarCollapsed && <span>{t('providers.status')}</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent side={isSidebarCollapsed ? 'right' : 'top'}>Provider Quotas &amp; Status</TooltipContent>
        </Tooltip>

        {/* Zotero Sync Trigger */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenZotero}
              className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center py-1.5' : 'space-x-2.5 px-3 py-1.5'} text-xs text-text-secondary hover:text-text-primary hover:bg-surface/40 rounded transition-[transform,background-color,color] duration-150 active:scale-[var(--scale-small)]`}
              aria-label={t('zotero.sync')}
            >
              <FolderSync className="w-3.5 h-3.5 shrink-0 text-accent" />
              {!isSidebarCollapsed && <span>{t('zotero.sync')}</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent side={isSidebarCollapsed ? 'right' : 'top'}>Zotero Sync &amp; Import</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => w.setIsSidebarCollapsed(!isSidebarCollapsed)}
              className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center py-1.5' : 'space-x-2.5 px-3 py-1.5'} text-xs text-text-tertiary hover:text-text-secondary rounded transition-[transform,background-color,color] duration-150 active:scale-[0.98]`}
              aria-label={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {isSidebarCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
              {!isSidebarCollapsed && <span>{t('app.collapse')}</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent side={isSidebarCollapsed ? 'right' : 'top'}>
            {isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          </TooltipContent>
        </Tooltip>
      </div>

      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        title={t('document.deleteDocument')}
        description={t('document.deleteConfirm')}
        onConfirm={() => {
          if (pendingDeleteId) {
            deleteDocument(pendingDeleteId);
          }
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </aside>
  );
};
