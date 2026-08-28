import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  isElectron: boolean;
  platform: NodeJS.Platform;
  minimize: () => void;
  maximize: () => void;
  unmaximize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
  getAppVersion: () => Promise<string>;
}

const electronAPI: ElectronAPI = {
  isElectron: true,
  platform: process.platform,
  minimize: () => {
    ipcRenderer.send('window:minimize');
  },
  maximize: () => {
    ipcRenderer.send('window:maximize');
  },
  unmaximize: () => {
    ipcRenderer.send('window:unmaximize');
  },
  toggleMaximize: () => {
    ipcRenderer.send('window:toggle-maximize');
  },
  close: () => {
    ipcRenderer.send('window:close');
  },
  isMaximized: () => {
    return ipcRenderer.invoke('window:is-maximized');
  },
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => {
      callback(isMaximized);
    };
    ipcRenderer.on('window:maximize-change', subscription);
    return () => {
      ipcRenderer.removeListener('window:maximize-change', subscription);
    };
  },
  openExternal: (url: string) => {
    return ipcRenderer.invoke('shell:open-external', url);
  },
  getAppVersion: () => {
    return ipcRenderer.invoke('app:get-version');
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
