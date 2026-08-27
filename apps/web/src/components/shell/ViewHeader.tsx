'use client';

import React from 'react';

interface ViewHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export const ViewHeader: React.FC<ViewHeaderProps> = ({ icon, title, subtitle, badge, actions }) => {
  return (
    <div className="border-b border-border-default bg-surface px-6 py-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 shrink-0 animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex items-center gap-3 min-w-[12rem]">
        <div className="p-2 rounded-md bg-accent/10 text-accent shrink-0">{icon}</div>
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="font-serif font-bold text-xl text-text-primary tracking-tight leading-tight whitespace-nowrap">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle && <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center flex-wrap gap-2 animate-in fade-in duration-150" style={{ animationDelay: 'var(--duration-stagger)' }}>{actions}</div>}
    </div>
  );
};
