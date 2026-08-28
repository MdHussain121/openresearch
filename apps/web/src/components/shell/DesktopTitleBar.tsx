'use client';

import React from 'react';
import { useDesktop } from '../../hooks/useDesktop';

interface DesktopTitleBarProps {
  title?: string;
  subtitle?: string;
}

export const DesktopTitleBar: React.FC<DesktopTitleBarProps> = ({
  title = 'OpenResearch',
  subtitle,
}) => {
  const { isElectron, isMaximized, platform, minimize, toggleMaximize, close } = useDesktop();

  // If not running inside Electron, do not render title bar
  if (!isElectron) {
    return null;
  }

  const isMac = platform === 'darwin';

  return (
    <div
      className={`h-[34px] w-full bg-surface border-b border-border-default flex items-center justify-between select-none shrink-0 z-50 transition-colors duration-150 app-drag ${
        isMac ? 'pl-20 pr-4' : 'pl-3 pr-0'
      }`}
      onDoubleClick={toggleMaximize}
    >
      {/* Left: App Identity */}
      <div className="flex items-center space-x-2 min-w-0">
        <svg
          viewBox="0 0 64 64"
          className="w-4 h-4 shrink-0 pointer-events-none"
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
        <span className="text-xs font-semibold text-text-primary tracking-tight truncate">
          {title}
        </span>
        {subtitle && (
          <>
            <span className="text-border-default text-xs">/</span>
            <span className="text-[11px] text-text-tertiary truncate font-medium">
              {subtitle}
            </span>
          </>
        )}
      </div>

      {/* Center: Subtle App Info Drag Region */}
      <div className="hidden sm:flex items-center justify-center flex-1 mx-4 min-w-0">
        <span className="text-[11px] text-text-tertiary font-mono tracking-wide truncate pointer-events-none opacity-60">
          Academic Research & Writing Assistant
        </span>
      </div>

      {/* Right: Window Controls (Windows / Linux) */}
      {!isMac && (
        <div className="flex items-center h-full app-no-drag">
          {/* Minimize Button */}
          <button
            type="button"
            onClick={minimize}
            className="w-[46px] h-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-sunken active:bg-sunken/80 transition-colors focus:outline-none"
            title="Minimize"
            aria-label="Minimize"
          >
            <svg width="10" height="1" viewBox="0 0 10 1">
              <rect width="10" height="1" fill="currentColor" />
            </svg>
          </button>

          {/* Maximize / Restore Button */}
          <button
            type="button"
            onClick={toggleMaximize}
            className="w-[46px] h-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-sunken active:bg-sunken/80 transition-colors focus:outline-none"
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              // Restore icon (overlapping squares)
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="2" y="0" width="8" height="8" stroke="currentColor" strokeWidth="1" />
                <path d="M0 2h6v6H0z" fill="var(--bg-surface)" />
                <rect x="0" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              // Maximize icon (single square)
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>

          {/* Close Button */}
          <button
            type="button"
            onClick={close}
            className="w-[46px] h-full flex items-center justify-center text-text-secondary hover:text-white hover:bg-[#E81123] active:bg-[#B80F1D] transition-colors focus:outline-none"
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
  );
};
