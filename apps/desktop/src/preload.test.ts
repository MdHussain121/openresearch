import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Desktop Preload Electron API Bridge', () => {
  let ipcSendMock: ReturnType<typeof vi.fn>;
  let ipcInvokeMock: ReturnType<typeof vi.fn>;
  let ipcOnMock: ReturnType<typeof vi.fn>;
  let ipcRemoveListenerMock: ReturnType<typeof vi.fn>;
  let exposedApi: any = null;

  beforeEach(() => {
    vi.resetModules();
    ipcSendMock = vi.fn();
    ipcInvokeMock = vi.fn();
    ipcOnMock = vi.fn();
    ipcRemoveListenerMock = vi.fn();

    vi.doMock('electron', () => ({
      contextBridge: {
        exposeInMainWorld: vi.fn((key, api) => {
          if (key === 'electronAPI') {
            exposedApi = api;
          }
        }),
      },
      ipcRenderer: {
        send: ipcSendMock,
        invoke: ipcInvokeMock,
        on: ipcOnMock,
        removeListener: ipcRemoveListenerMock,
      },
    }));
  });

  it('exposes electronAPI on contextBridge with window controls and IPC methods', async () => {
    await import('./preload.js');

    expect(exposedApi).not.toBeNull();
    expect(exposedApi.isElectron).toBe(true);
    expect(exposedApi.platform).toBe(process.platform);

    exposedApi.minimize();
    expect(ipcSendMock).toHaveBeenCalledWith('window:minimize');

    exposedApi.maximize();
    expect(ipcSendMock).toHaveBeenCalledWith('window:maximize');

    exposedApi.unmaximize();
    expect(ipcSendMock).toHaveBeenCalledWith('window:unmaximize');

    exposedApi.toggleMaximize();
    expect(ipcSendMock).toHaveBeenCalledWith('window:toggle-maximize');

    exposedApi.close();
    expect(ipcSendMock).toHaveBeenCalledWith('window:close');

    ipcInvokeMock.mockResolvedValueOnce(true);
    const isMax = await exposedApi.isMaximized();
    expect(isMax).toBe(true);
    expect(ipcInvokeMock).toHaveBeenCalledWith('window:is-maximized');

    ipcInvokeMock.mockResolvedValueOnce('1.0.0');
    const version = await exposedApi.getAppVersion();
    expect(version).toBe('1.0.0');
    expect(ipcInvokeMock).toHaveBeenCalledWith('app:get-version');

    await exposedApi.openExternal('https://openresearch.dev');
    expect(ipcInvokeMock).toHaveBeenCalledWith('shell:open-external', 'https://openresearch.dev');
  });

  it('subscribes and unsubscribes to window maximize change events', async () => {
    await import('./preload.js');

    const callback = vi.fn();
    const unsubscribe = exposedApi.onMaximizeChange(callback);

    expect(ipcOnMock).toHaveBeenCalledWith('window:maximize-change', expect.any(Function));

    const handler = ipcOnMock.mock.calls[0][1];
    handler({}, true);
    expect(callback).toHaveBeenCalledWith(true);

    unsubscribe();
    expect(ipcRemoveListenerMock).toHaveBeenCalledWith('window:maximize-change', handler);
  });
});
