import path from 'node:path';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { app, BrowserWindow, dialog } from 'electron';
import { buildApp, BuiltApp } from '../server/app';
import { readEnv } from '../server/utils/env';

const host = '127.0.0.1';

let builtApp: BuiltApp | undefined;
let server: Server | undefined;
let mainWindow: BrowserWindow | undefined;

const startBackend = async (): Promise<string> => {
  if (!app.isReady()) {
    throw new Error('Electron app must be ready before starting backend.');
  }

  const requestedPort = Number(readEnv('SIDELINK_DESKTOP_PORT', 'ALTSTORE_DESKTOP_PORT') ?? 0);
  const safePort = Number.isFinite(requestedPort) && requestedPort >= 0 ? requestedPort : 0;

  const userDataDir = app.getPath('userData');
  const defaultDataDir = app.isPackaged
    ? userDataDir
    : path.resolve(process.cwd(), 'tmp', 'desktop');

  const uploadDir = readEnv('SIDELINK_UPLOAD_DIR', 'ALTSTORE_UPLOAD_DIR') || path.join(defaultDataDir, 'uploads');
  const dbPath = readEnv('SIDELINK_DB_PATH', 'ALTSTORE_DB_PATH') || path.join(defaultDataDir, 'sidelink.sqlite');

  builtApp = buildApp({
    uploadDir,
    dbPath,
    defaultMode: readEnv('SIDELINK_MODE', 'ALTSTORE_MODE') === 'real' ? 'real' : 'demo'
  });

  process.env.SIDELINK_CLIENT_DIR = path.resolve(__dirname, '../client');

  const url = await new Promise<string>((resolve, reject) => {
    server = builtApp?.app.listen(safePort, host, () => {
      const address = server?.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Desktop backend failed to bind to TCP address.'));
        return;
      }

      resolve(`http://${host}:${(address as AddressInfo).port}`);
    });

    server?.on('error', reject);
  });

  return url;
};

const createWindow = async (): Promise<void> => {
  const url = await startBackend();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1120,
    minHeight: 760,
    title: 'Sidelink',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadURL(url);

  if (readEnv('SIDELINK_DESKTOP_DEVTOOLS', 'ALTSTORE_DESKTOP_DEVTOOLS') === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
};

const stopBackend = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });

  if (builtApp) {
    builtApp.context.shutdown();
  }

  server = undefined;
  builtApp = undefined;
};

app.whenReady().then(() => {
  void createWindow().catch(async (error) => {
    dialog.showErrorBox('Sidelink failed to start', error instanceof Error ? error.message : String(error));
    await stopBackend();
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('before-quit', () => {
  void stopBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
