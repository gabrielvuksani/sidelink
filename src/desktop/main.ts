// ─── Electron Main Process ───────────────────────────────────────────
// Launches the Express backend, opens a BrowserWindow, sets up tray,
// native menus, IPC bridge, auto-updater, and deep link handling.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import os from 'node:os';
import { app, BrowserWindow, dialog, session } from 'electron';

import { IPC } from './ipc-channels';

import { registerIpcHandlers } from './ipc-handlers';
import { setupAutoUpdater } from './auto-updater';
import { createTray, updateTrayMenu, destroyTray } from './tray';
import { createAppMenu } from './menu';
import { loadWindowState, trackWindowState } from './window-state';
import { startDiscoveryBroadcaster } from '../server/utils/discovery';

// ── Constants ────────────────────────────────────────────────────────

const HOST = readEnv('SIDELINK_HOST', 'HOST') ?? '0.0.0.0';
const PROTOCOL = 'sidelink'; // sidelink:// deep links
const RESET_FRESH_ARG = '--sidelink-reset-fresh';
const KEYCHAIN_SERVICE_NAME = 'com.sidelink.secrets';
const KEYCHAIN_ACCOUNT_NAME = 'master-key';

let server: Server | undefined;
let shutdownFn: (() => void) | undefined;
let mainWindow: BrowserWindow | undefined;
let backendUrl: string | undefined;
let trayUpdateTimer: ReturnType<typeof setInterval> | undefined;
let stopDiscoveryBroadcast: (() => void) | undefined;

// ── Utility ──────────────────────────────────────────────────────────

function readEnv(...keys: string[]): string | undefined {
  for (const k of keys) {
    if (process.env[k]) return process.env[k];
  }
  return undefined;
}

function isSmokeTestMode(): boolean {
  return readEnv('SIDELINK_SMOKE_TEST') === '1';
}

function isFreshResetRequested(): boolean {
  return process.argv.includes(RESET_FRESH_ARG);
}

async function clearStoredMasterKey(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const keytar = require('keytar') as { deletePassword(service: string, account: string): Promise<boolean> };
    const deleted = await keytar.deletePassword(KEYCHAIN_SERVICE_NAME, KEYCHAIN_ACCOUNT_NAME);
    console.log(deleted
      ? '[desktop] removed stored master key during fresh reset'
      : '[desktop] no stored master key found during fresh reset');
  } catch {
    console.log('[desktop] keytar unavailable during fresh reset; skipped master key cleanup');
  }
}

async function performFreshResetIfRequested(): Promise<void> {
  if (!isFreshResetRequested()) return;

  const userDataDir = app.getPath('userData');
  const configuredDataDir = readEnv('SIDELINK_DATA_DIR');
  const targets = [...new Set([userDataDir, configuredDataDir].filter(Boolean))] as string[];

  for (const target of targets.sort((left, right) => right.length - left.length)) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[desktop] fresh reset removed ${target}`);
    } catch (err) {
      console.warn(`[desktop] failed to remove ${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  fs.mkdirSync(userDataDir, { recursive: true });
  await clearStoredMasterKey();
}

// ── Deep Link Protocol ──────────────────────────────────────────────

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Enforce single instance (required for deep links)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Someone tried to open a second instance — focus existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Handle deep link from argv on Windows/Linux
    const deepLink = argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
    if (deepLink) handleDeepLink(deepLink);
  });
}

// macOS: handle deep link when app is already running
app.on('open-url', (_event, url) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  handleDeepLink(url);
});

function handleDeepLink(url: string): void {
  // Parse sidelink:// URLs and navigate the renderer
  // e.g., sidelink://install?ipa=https://...
  if (!mainWindow) return;
  try {
    const parsed = new URL(url);
    // Send to renderer via query params on the current page
    mainWindow.webContents.send(IPC.DEEP_LINK, {
      action: parsed.hostname || parsed.pathname.replace(/^\//, ''),
      params: Object.fromEntries(parsed.searchParams),
    });
  } catch {
    // Invalid URL, ignore
  }
}

// ── Backend Startup ──────────────────────────────────────────────────

async function startBackend(): Promise<string> {
  if (!app.isReady()) throw new Error('Electron app must be ready before starting backend.');

  const requestedPort = Number(readEnv('SIDELINK_PORT', 'SIDELINK_DESKTOP_PORT') ?? 0);
  const safePort = Number.isFinite(requestedPort) && requestedPort >= 0 ? requestedPort : 0;

  const userDataDir = app.getPath('userData');
  const defaultDataDir = app.isPackaged
    ? userDataDir
    : path.resolve(process.cwd(), 'tmp', 'desktop');

  // Set env variables the server will read
  process.env.SIDELINK_DATA_DIR = readEnv('SIDELINK_DATA_DIR') ?? defaultDataDir;
  process.env.SIDELINK_PORT = String(safePort);

  // Point static file serving at the built React client
  process.env.SIDELINK_CLIENT_DIR = app.isPackaged
    ? path.join(process.resourcesPath, 'client')
    : path.resolve(__dirname, '../client');

  if (app.isPackaged) {
    const clientIndexPath = path.join(process.env.SIDELINK_CLIENT_DIR, 'index.html');
    if (!fs.existsSync(clientIndexPath)) {
      throw new Error(`Packaged client bundle missing: ${clientIndexPath}`);
    }
  }

  // Dynamic import so we don't pull server code at module init
  const { createAppContextAsync } = await import('../server/context');
  const { createApp } = await import('../server/app');
  const { recoverStalledJobs } = await import('../server/pipeline');

  // Generate an internal token for in-process API calls (tray polling, etc.)
  // This is recognized by the auth middleware as a valid session.
  const internalToken = crypto.randomBytes(32).toString('hex');
  process.env.SIDELINK_INTERNAL_TOKEN = internalToken;

  const ctx = await createAppContextAsync({ dataDir: process.env.SIDELINK_DATA_DIR });
  shutdownFn = ctx.shutdown;

  // Recover stalled jobs from previous crash
  recoverStalledJobs(ctx.db, ctx.logs);

  // Start device polling & scheduler
  ctx.devices.startPolling(15_000);
  ctx.scheduler.start();

  const expressApp = createApp(ctx);

  const url = await new Promise<string>((resolve, reject) => {
    server = expressApp.listen(safePort, HOST, () => {
      const addr = server?.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind TCP address.'));
        return;
      }
      resolve(`http://${HOST}:${(addr as AddressInfo).port}`);
    });
    server?.on('error', reject);
  });

  // Start tray state updates — poll device/job counts every 15s
  startTrayPolling(url, internalToken);
  stopDiscoveryBroadcast = startDiscoveryBroadcaster({
    name: `SideLink (${os.hostname()})`,
    port: Number(new URL(url).port),
  });

  return url;
}

// ── Tray State Polling ───────────────────────────────────────────────

function startTrayPolling(baseUrl: string, authToken: string): void {
  if (trayUpdateTimer) return;

  const headers = { Authorization: `Bearer ${authToken}` };

  const poll = async () => {
    try {
      const [devRes, jobRes] = await Promise.all([
        fetch(`${baseUrl}/api/devices`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`${baseUrl}/api/install/jobs?status=running`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
      ]);
      const deviceCount = Array.isArray(devRes.data) ? devRes.data.length : 0;
      const jobsRunning = Array.isArray(jobRes.data) ? jobRes.data.length : 0;
      updateTrayMenu({ deviceCount, jobsRunning });
    } catch (err) {
      // Non-critical: tray just shows stale data
      console.warn('[tray] Polling failed:', err);
    }
  };

  // Initial update
  setTimeout(poll, 2000);
  trayUpdateTimer = setInterval(poll, 15_000);
}

function stopTrayPolling(): void {
  if (trayUpdateTimer) {
    clearInterval(trayUpdateTimer);
    trayUpdateTimer = undefined;
  }
}

// ── Window Creation ──────────────────────────────────────────────────

function buildWindow(): BrowserWindow {
  const savedState = loadWindowState();
  const win = new BrowserWindow({
    ...(savedState.x !== undefined ? { x: savedState.x, y: savedState.y } : {}),
    width: savedState.width,
    height: savedState.height,
    minWidth: 1024,
    minHeight: 680,
    title: 'SideLink',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
    backgroundColor: '#030712', // gray-950 to prevent white flash
    show: false, // show after ready-to-show for smooth appearance
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for preload
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (savedState.isMaximized) win.maximize();
  trackWindowState(win);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { mainWindow = undefined; });
  return win;
}

async function createWindow(): Promise<void> {
  backendUrl = await startBackend();
  mainWindow = buildWindow();
  await mainWindow.loadURL(backendUrl);

  if (readEnv('SIDELINK_DEVTOOLS') === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createWindowFromExistingBackend(): void {
  if (!backendUrl) return;
  mainWindow = buildWindow();
  void mainWindow.loadURL(backendUrl);
}

// ── Backend Shutdown ─────────────────────────────────────────────────

async function stopBackend(): Promise<void> {
  stopTrayPolling();
  stopDiscoveryBroadcast?.();
  stopDiscoveryBroadcast = undefined;
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  shutdownFn?.();
  server = undefined;
  shutdownFn = undefined;
}

// ── Electron Lifecycle ──────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[desktop] Uncaught exception:', err);
  if (isSmokeTestMode()) {
    app.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[desktop] Unhandled rejection:', reason);
  if (isSmokeTestMode()) {
    app.exit(1);
  }
});

app.whenReady().then(async () => {
  await performFreshResetIfRequested();

  if (isSmokeTestMode()) {
    try {
      backendUrl = await startBackend();
      console.log(`[desktop:smoke] backend started at ${backendUrl}`);
      await stopBackend();
      console.log('[desktop:smoke] packaged startup check passed');
      app.exit(0);
    } catch (err) {
      console.error('[desktop:smoke] startup check failed:', err instanceof Error ? err.message : String(err));
      await stopBackend();
      app.exit(1);
    }
    return;
  }

  // Enforce CSP in production Electron renderer
  if (!app.isPackaged || readEnv('SIDELINK_DEVTOOLS') !== '1') {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          ],
        },
      });
    });
  }

  // Register IPC handlers before creating any windows
  registerIpcHandlers();

  // Set up native menu
  createAppMenu();

  // Set up auto-updater
  setupAutoUpdater();

  // Create tray icon
  createTray();

  // Create the main window
  void createWindow().catch(async (err) => {
    dialog.showErrorBox(
      'SideLink failed to start',
      err instanceof Error ? err.message : String(err),
    );
    await stopBackend();
    app.quit();
  });

  app.on('activate', () => {
    // macOS: re-open window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0 && !mainWindow) {
      if (server) {
        createWindowFromExistingBackend();
      } else {
        void createWindow();
      }
    }
  });
});

app.on('before-quit', () => {
  destroyTray();
  void stopBackend();
});

app.on('window-all-closed', () => {
  // On macOS, keep the app running in the tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
