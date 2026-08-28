'use client';

import { useState, useEffect, useCallback } from 'react';

export function useDesktop() {
  const [mounted, setMounted] = useState<boolean>(false);
  const [isElectron, setIsElectron] = useState<boolean>(false);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [platform, setPlatform] = useState<string>('');

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
      setIsElectron(true);
      setPlatform(window.electronAPI.platform || '');

      window.electronAPI.isMaximized().then((maximized) => {
        setIsMaximized(maximized);
      });

      const unsubscribe = window.electronAPI.onMaximizeChange((maximized) => {
        setIsMaximized(maximized);
      });

      return () => {
        unsubscribe?.();
      };
    }
  }, []);

  const minimize = useCallback(() => {
    window.electronAPI?.minimize();
  }, []);

  const maximize = useCallback(() => {
    window.electronAPI?.maximize();
  }, []);

  const unmaximize = useCallback(() => {
    window.electronAPI?.unmaximize();
  }, []);

  const toggleMaximize = useCallback(() => {
    window.electronAPI?.toggleMaximize();
  }, []);

  const close = useCallback(() => {
    window.electronAPI?.close();
  }, []);

  return {
    mounted,
    isElectron: mounted && isElectron,
    isMaximized,
    platform,
    minimize,
    maximize,
    unmaximize,
    toggleMaximize,
    close,
  };
}
