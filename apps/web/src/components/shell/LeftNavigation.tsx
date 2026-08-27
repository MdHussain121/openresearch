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

  if (isSidebarCollapsed) {
    return (
      <aside className="border-r border-border-default bg-sunken flex flex-col justify-between shrink-0 w-[var(--sidebar-collapsed-width)] transition-[width] duration-250 ease-smooth-out">
        <nav className="space-y-1 p-1.5">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === NAV_ROUTES[item.nav];
            return (
              <button
                key={item.nav}
                onClick={() => router.push(NAV_ROUTES[item.nav])}
                className={`w-full flex items-center justify-center py-2 text-xs rounded transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[var(--scale-small)] ${
                  isActive
                    ? 'border-l-2 border-accent text-accent font-medium bg-surface/60'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface/30'
                }`}
                title={item.title}
              >
                {item.icon}
              </button>
            );
          })}
        </nav>

        <div className="pt-2 border-t border-border-default/60 space-y-1 p-1.5">
          <button
            onClick={onOpenPlugins}
            className="w-full flex items-center justify-center py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface/40 rounded transition-[transform,background-color,color] duration-150 active:scale-[var(--scale-small)]"
            title="Community Plugins"
          >
            <Boxes className="w-3.5 h-3.5 shrink-0 text-accent" />
          </button>
          <button
            onClick={onOpenProviderQuota}
            className="w-full flex items-center justify-center py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface/40 rounded transition-[transform,background-color,color] duration-150 active:scale-[var(--scale-small)]"
            title="Provider Quotas & Status"
          >
            <Gauge className="w-3.5 h-3.5 shrink-0 text-accent" />
          </button>
          <button
            onClick={onOpenZotero}
            className="w-full flex items-center justify-center py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface/40 rounded transition-[transform,background-color,color] duration-150 active:scale-[var(--scale-small)]"
            title="Zotero Sync & Import"
          >
            <FolderSync className="w-3.5 h-3.5 shrink-0 text-accent" />
          </button>
          <button
            onClick={() => w.setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="w-full flex items-center justify-center py-1.5 text-xs text-text-tertiary hover:text-text-secondary rounded transition-[transform,background-color,color] duration-150 active:scale-[0.98]"
            title="Expand Sidebar"
          >
            <PanelLeftOpen className="w-3.5 h-3.5" />
          </button>
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
  }

  return (
    <aside
      className={`border-r border-border-default bg-sunken flex flex-col justify-between shrink-0 contain-layout w-[var(--sidebar-width)] transition-[width] duration-250 ease-smooth-out`}
    >
      <div className="flex-1 overflow-hidden">
        <div className="space-y-4 p-2">
          {/* Nav Links */}
          <nav className="space-y-1">
            {NAV_ITEMS.map((item, idx) => {
              const isActive = pathname === NAV_ROUTES[item.nav];
              return (
                <button
                  key={item.nav}
                  onClick={() => router.push(NAV_ROUTES[item.nav])}
                  style={!isSidebarCollapsed ? { animationDelay: `${Math.min(idx * 40, 240)}ms` } : undefined}
                  className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-0' : 'space-x-3 px-3'} py-2 text-xs rounded transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[var(--scale-small)] ${!isSidebarCollapsed ? 'animate-fade-slide-in' : ''} border-l-2 ${
                    isActive
                      ? 'border-accent text-accent font-medium bg-surface/60'
                      : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface/30'
                  }`}
                  title={item.title}
                >
                  {item.icon}
                  {!isSidebarCollapsed && (
                    <div className="flex items-center justify-between w-full transition-opacity duration-150" style={{ transitionDelay: '40ms' }}>
                      <span className={item.nav === 'intelligence' ? 'truncate' : undefined}>
                        {item.label}
                      </span>
                      {item.nav === 'library' && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface border border-border-default text-text-tertiary">
                          {papersCount}
                        </span>
                      )}
                      {item.nav === 'citations' && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-surface border border-border-default text-text-tertiary font-mono">
                          {citationStyle.toUpperCase()}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Document List Sub-Section - animated disclosure */}
          {!isSidebarCollapsed && (
            <div className="pt-2 border-t border-border-default/60 space-y-2 animate-in fade-in duration-150" style={{ transitionTimingFunction: 'var(--ease-default)' }}>
              <style>{`@media(prefers-reduced-motion:reduce){.docs-disclosure{animation:none!important}}`}</style>
              <div className="flex items-center justify-between px-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                <span>{t('document.documents')}</span>
                <button
                  onClick={() => createDocument()}
                  className="p-1 rounded hover:bg-surface text-accent"
                  title={t('document.newDocument')}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-0.5 max-h-56 overflow-y-auto px-1">
                {documents.map((doc, idx) => (
                  <button
                    key={doc.id}
                    onClick={() => setActiveDocument(doc)}
                    aria-current={activeDocument?.id === doc.id ? 'page' : undefined}
                    style={{ animationDelay: `${Math.min(idx * 40, 240)}ms` }}
                    className={`group flex items-center justify-between w-full px-2.5 py-1.5 text-xs rounded cursor-pointer transition-[transform,background-color,color,box-shadow] duration-150 active:scale-[var(--scale-small)] text-left animate-fade-slide-in ${
                      activeDocument?.id === doc.id
                        ? 'bg-surface text-accent font-medium shadow-2xs'
                        : 'text-text-secondary hover:text-text-primary hover:bg-surface/50'
                    }`}
                  >
                    <span className="truncate pr-1">{doc.title || t('document.untitled')}</span>
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
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 p-0.5 text-text-tertiary hover:text-trust-danger transition-opacity duration-150"
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
      <div className="px-2 pb-2 pt-2 border-t border-border-default/60 space-y-1 shrink-0">
        {/* Plugin Manager Trigger */}
        <button
          onClick={onOpenPlugins}
          className="w-full flex items-center space-x-2.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface/40 rounded transition-[transform,background-color,color] duration-150 active:scale-[var(--scale-small)]"
          title="Community Plugins"
        >
          <Boxes className="w-3.5 h-3.5 shrink-0 text-accent" />
          <span>{t('plugins.title')}</span>
        </button>

        {/* Provider Quota Trigger */}
        <button
          onClick={onOpenProviderQuota}
          className="w-full flex items-center space-x-2.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface/40 rounded transition-[transform,background-color,color] duration-150 active:scale-[var(--scale-small)]"
          title="Provider Quotas & Status"
        >
          <Gauge className="w-3.5 h-3.5 shrink-0 text-accent" />
          <span>{t('providers.status')}</span>
        </button>

        {/* Zotero Sync Trigger */}
        <button
          onClick={onOpenZotero}
          className="w-full flex items-center space-x-2.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface/40 rounded transition-[transform,background-color,color] duration-150 active:scale-[var(--scale-small)]"
          title="Zotero Sync & Import"
        >
          <FolderSync className="w-3.5 h-3.5 shrink-0 text-accent" />
          <span>{t('zotero.sync')}</span>
        </button>

        <button
          onClick={() => w.setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="w-full flex items-center space-x-2.5 px-3 py-1.5 text-xs text-text-tertiary hover:text-text-secondary rounded transition-[transform,background-color,color] duration-150 active:scale-[0.98]"
          title="Collapse Sidebar"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
          <span>{t('app.collapse')}</span>
        </button>
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
