import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

// Set App User Model ID on Windows for proper taskbar grouping & icon display
if (process.platform === 'win32') {
  app.setAppUserModelId('org.openresearch.desktop');
}

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

function getAppIcon(): string | undefined {
  const icoCandidate = path.join(__dirname, '../assets/icon.ico');
  const pngCandidate = path.join(__dirname, '../assets/icon.png');
  const packagedIco = path.join(process.resourcesPath || '', 'assets/icon.ico');
  const packagedPng = path.join(process.resourcesPath || '', 'assets/icon.png');

  if (process.platform === 'win32') {
    if (fs.existsSync(icoCandidate)) return icoCandidate;
    if (fs.existsSync(packagedIco)) return packagedIco;
    if (fs.existsSync(pngCandidate)) return pngCandidate;
    if (fs.existsSync(packagedPng)) return packagedPng;
  } else {
    if (fs.existsSync(pngCandidate)) return pngCandidate;
    if (fs.existsSync(packagedPng)) return packagedPng;
    if (fs.existsSync(icoCandidate)) return icoCandidate;
  }
  return undefined;
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const FRONTEND_PORT = process.env.FRONTEND_PORT || '3000';
const BACKEND_PORT = process.env.BACKEND_PORT || '8000';
const WEB_URL = process.env.APP_URL || `http://localhost:${FRONTEND_PORT}`;

function checkServerReady(url: string, timeoutMs: number = 30000): Promise<boolean> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const parsedUrl = new URL(url);
      const req = http.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: 'GET',
          timeout: 1000,
        },
        (res) => {
          if (res.statusCode && res.statusCode < 500) {
            resolve(true);
          } else if (Date.now() - startTime < timeoutMs) {
            setTimeout(check, 500);
          } else {
            resolve(false);
          }
        }
      );

      req.on('error', () => {
        if (Date.now() - startTime < timeoutMs) {
          setTimeout(check, 500);
        } else {
          resolve(false);
        }
      });

      req.end();
    };

    check();
  });
}

function startBackendIfNeeded() {
  if (process.env.AUTO_START_BACKEND === 'true' && !backendProcess) {
    const rootDir = path.resolve(__dirname, '../../..');
    const apiDir = path.join(rootDir, 'apps', 'api');
    const pyExe = process.platform === 'win32'
      ? path.join(apiDir, '.venv', 'Scripts', 'python.exe')
      : path.join(apiDir, '.venv', 'bin', 'python');

    try {
      backendProcess = spawn(pyExe, ['-m', 'uvicorn', 'app.main:app', '--port', BACKEND_PORT], {
        cwd: apiDir,
        stdio: 'inherit',
        env: { ...process.env },
      });

      backendProcess.on('exit', (code) => {
        console.log(`[OpenResearch Backend] Exited with code ${code}`);
        backendProcess = null;
      });
    } catch (err) {
      console.error('[OpenResearch Backend] Failed to spawn FastAPI:', err);
    }
  }
}

function stopBackend() {
  if (backendProcess) {
    console.log('[OpenResearch Backend] Terminating backend process...');
    if (process.platform === 'win32' && backendProcess.pid) {
      try {
        spawn('taskkill', ['/pid', backendProcess.pid.toString(), '/f', '/t']);
      } catch (e) {
        backendProcess.kill();
      }
    } else {
      backendProcess.kill('SIGTERM');
    }
    backendProcess = null;
  }
}

async function createWindow() {
  startBackendIfNeeded();

  const iconPath = getAppIcon();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: false,
    backgroundColor: '#17171A',
    icon: iconPath,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (iconPath && process.platform === 'win32' && mainWindow) {
      try {
        mainWindow.setIcon(iconPath);
      } catch {}
    }
    mainWindow?.show();
    mainWindow?.focus();
  });

  // Track and send maximize / unmaximize events to renderer for dynamic icon switching
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximize-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximize-change', false);
  });

  // Handle external link clicks and window opening safely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Prevent in-window navigation to external origins (e.g. arXiv, DOIs) and open in default browser
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      const appParsedUrl = new URL(WEB_URL);
      if (parsedUrl.origin !== appParsedUrl.origin && parsedUrl.protocol !== 'devtools:') {
        event.preventDefault();
        shell.openExternal(navigationUrl);
      }
    } catch {
      // ignore invalid URLs
    }
  });

  // Prevent child frames from navigating to external origins that trigger ERR_BLOCKED_BY_RESPONSE
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    try {
      if (event.isMainFrame) return;
      const parsedUrl = new URL(event.url);
      const appParsedUrl = new URL(WEB_URL);
      if (
        parsedUrl.origin !== appParsedUrl.origin &&
        !event.url.startsWith('about:') &&
        !event.url.startsWith('blob:') &&
        !event.url.startsWith('data:')
      ) {
        event.preventDefault();
        shell.openExternal(event.url);
      }
    } catch {
      // ignore invalid URLs
    }
  });

  // Handle failed sub-frame loads gracefully without uncaught exceptions
  mainWindow.webContents.on('did-fail-load', (_event, _errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }
  });

  // Wait for the web server and load the app
  const isReady = await checkServerReady(WEB_URL, 15000);
  if (isReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(WEB_URL);
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(WEB_URL);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Register IPC handlers for custom title bar and window actions
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:maximize', () => {
  mainWindow?.maximize();
});

ipcMain.on('window:unmaximize', () => {
  mainWindow?.unmaximize();
});

ipcMain.on('window:toggle-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:is-maximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('shell:open-external', async (_event, url: string) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:'))) {
    await shell.openExternal(url);
  }
});

ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});

// App Lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
