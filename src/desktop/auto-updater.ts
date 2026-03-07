// ─── Auto-Updater Module ─────────────────────────────────────────────
// Wraps electron-updater with IPC support so the renderer can
// trigger checks, receive progress events, and install updates.
//
// In development (app.isPackaged === false), all operations are no-ops
// so the UI can still render update-related components without errors.

import { app, ipcMain, BrowserWindow } from 'electron';
import { IPC } from './ipc-channels';
import type { UpdaterEvent } from './ipc-channels';

let autoUpdaterLoaded = false;
let autoUpdater: any; // electron-updater's autoUpdater
let lastStatus: UpdaterEvent = { type: 'not-available' };

function isManualOnlyMacIntelBuild(): boolean {
  return process.platform === 'darwin' && process.arch === 'x64';
}

function formatUpdaterError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('latest-mac.yml') && message.includes('404')) {
    return 'Update metadata is missing from the GitHub release. Publish latest-mac.yml, the matching macOS zip, and related blockmap files for in-app updates to work.';
  }

  return message;
}

/**
 * Attempt to load electron-updater. Returns false if not available
 * (e.g., in dev mode or if the package isn't installed).
 */
function ensureAutoUpdater(): boolean {
  if (autoUpdaterLoaded) return !!autoUpdater;
  autoUpdaterLoaded = true;

  try {
    // electron-updater is an optional prod dependency.
    // Accessing .autoUpdater reads app-update.yml synchronously —
    // wrap in try/catch to handle ENOENT from --dir builds.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('electron-updater');
    autoUpdater = mod.autoUpdater;
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') && msg.includes('app-update.yml')) {
      console.log('[updater] app-update.yml not found — auto-updates disabled (use a distributable build for updates)');
    } else {
      console.log(`[updater] electron-updater not available: ${msg}`);
    }
    return false;
  }
}

/**
 * Broadcast an updater event to all open windows.
 */
function broadcast(event: UpdaterEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.UPDATER_EVENT, event);
    }
  }
}

export async function checkForUpdates(): Promise<void> {
  if (isManualOnlyMacIntelBuild()) {
    lastStatus = {
      type: 'error',
      error: 'In-app updates are only published for the Apple silicon mac build right now. Download the latest Intel DMG manually from GitHub Releases.',
    };
    broadcast(lastStatus);
    return;
  }

  if (!ensureAutoUpdater()) return;
  await autoUpdater.checkForUpdates();
}

/**
 * Set up auto-updater event listeners and IPC handlers.
 * Call once during app startup.
 */
export function setupAutoUpdater(): void {
  // ── IPC handlers (always registered, even if updater unavailable) ──

  ipcMain.handle(IPC.UPDATER_CHECK, async () => {
    try {
      await checkForUpdates();
    } catch (err) {
      broadcast({
        type: 'error',
        error: formatUpdaterError(err),
      });
    }
  });

  ipcMain.handle(IPC.UPDATER_DOWNLOAD, async () => {
    if (isManualOnlyMacIntelBuild()) {
      lastStatus = {
        type: 'error',
        error: 'In-app updates are only published for the Apple silicon mac build right now. Download the latest Intel DMG manually from GitHub Releases.',
      };
      broadcast(lastStatus);
      return;
    }

    if (!ensureAutoUpdater()) return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      broadcast({
        type: 'error',
        error: formatUpdaterError(err),
      });
    }
  });

  ipcMain.on(IPC.UPDATER_INSTALL, () => {
    if (!ensureAutoUpdater()) return;
    autoUpdater.quitAndInstall();
  });

  // ── Auto-updater event → IPC bridge ────────────────────────────────

  if (!ensureAutoUpdater()) return;

  // Don't auto-download — let the user choose
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Logging
  autoUpdater.logger = {
    info: (msg: string) => console.log(`[updater] ${msg}`),
    warn: (msg: string) => console.warn(`[updater] ${msg}`),
    error: (msg: string) => console.error(`[updater] ${msg}`),
    debug: (msg: string) => console.log(`[updater:debug] ${msg}`),
  };

  autoUpdater.on('checking-for-update', () => {
    lastStatus = { type: 'checking' };
    broadcast(lastStatus);
  });

  autoUpdater.on('update-available', (info: any) => {
    lastStatus = {
      type: 'available',
      info: { version: info.version, releaseDate: info.releaseDate },
    };
    broadcast(lastStatus);
  });

  autoUpdater.on('update-not-available', () => {
    lastStatus = { type: 'not-available' };
    broadcast(lastStatus);
  });

  autoUpdater.on('download-progress', (progress: any) => {
    lastStatus = {
      type: 'downloading',
      info: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        total: progress.total,
        transferred: progress.transferred,
      },
    };
    broadcast(lastStatus);
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    lastStatus = {
      type: 'downloaded',
      info: { version: info.version },
    };
    broadcast(lastStatus);
  });

  autoUpdater.on('error', (err: Error) => {
    lastStatus = { type: 'error', error: formatUpdaterError(err) };
    broadcast(lastStatus);
  });

  // ── Auto-check on startup (after a short delay) ──────────────────
  if (app.isPackaged) {
    setTimeout(() => {
      checkForUpdates().catch(() => {
        // Silent — user can manually check
      });
    }, 10_000);
  }
}
