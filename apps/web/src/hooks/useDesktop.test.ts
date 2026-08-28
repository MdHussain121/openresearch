// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import React, { createElement } from 'react';
import { useDesktop } from './useDesktop';

function TestDesktopConsumer({ onState }: { onState: (state: any) => void }) {
  const desktop = useDesktop();
  onState(desktop);
  return createElement('div', { 'data-testid': 'desktop-consumer' });
}

describe('useDesktop hook', () => {
  beforeEach(() => {
    delete (window as any).electronAPI;
  });

  it('returns default false when not running inside Electron', () => {
    let capturedState: any = null;
    const container = document.createElement('div');
    document.body.appendChild(container);

    const root = createRoot(container);
    flushSync(() => {
      root.render(
        createElement(TestDesktopConsumer, {
          onState: (state) => {
            capturedState = state;
          },
        })
      );
    });

    expect(capturedState?.isElectron).toBe(false);
    expect(capturedState?.isMaximized).toBe(false);
    expect(capturedState?.platform).toBe('');

    root.unmount();
    container.remove();
  });

  it('detects Electron environment and responds to window state changes', async () => {
    let maximizeCallback: ((isMaximized: boolean) => void) | null = null;
    const mockMinimize = vi.fn();
    const mockToggleMaximize = vi.fn();
    const mockClose = vi.fn();

    (window as any).electronAPI = {
      isElectron: true,
      platform: 'win32',
      minimize: mockMinimize,
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      toggleMaximize: mockToggleMaximize,
      close: mockClose,
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizeChange: (cb: (isMaximized: boolean) => void) => {
        maximizeCallback = cb;
        return () => {
          maximizeCallback = null;
        };
      },
      openExternal: vi.fn(),
      getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
    };

    let capturedState: any = null;
    const container = document.createElement('div');
    document.body.appendChild(container);

    const root = createRoot(container);
    const renderApp = () => {
      flushSync(() => {
        root.render(
          createElement(TestDesktopConsumer, {
            onState: (state) => {
              capturedState = state;
            },
          })
        );
      });
    };

    renderApp();
    renderApp();

    expect(capturedState?.isElectron).toBe(true);
    expect(capturedState?.platform).toBe('win32');

    // Test maximize callback
    flushSync(() => {
      maximizeCallback?.(true);
    });

    expect(capturedState?.isMaximized).toBe(true);

    // Test window actions
    capturedState?.minimize();
    expect(mockMinimize).toHaveBeenCalledTimes(1);

    capturedState?.toggleMaximize();
    expect(mockToggleMaximize).toHaveBeenCalledTimes(1);

    capturedState?.close();
    expect(mockClose).toHaveBeenCalledTimes(1);

    root.unmount();
    container.remove();
  });
});
