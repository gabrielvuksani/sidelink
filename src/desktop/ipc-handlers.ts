// ─── IPC Handlers (Main Process) ─────────────────────────────────────
// Registers all ipcMain handlers that the preload bridge invokes.
// Separated from main.ts for clarity and testability.

import {
  app,
  ipcMain,
  BrowserWindow,
  dialog,
  shell,
} from 'electron';
import { IPC } from './ipc-channels';
import type {
  DialogOpenFileOptions,
  DialogSaveFileOptions,
  DialogMessageOptions,
} from './ipc-channels';

/**
 * Register all IPC handlers. Call once during app startup.
 */
export function registerIpcHandlers(): void {
  // ── App lifecycle ──────────────────────────────────────────────────

  ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());
  ipcMain.handle(IPC.APP_PLATFORM, () => process.platform);
  ipcMain.handle(IPC.APP_IS_PACKAGED, () => app.isPackaged);
  ipcMain.handle(IPC.APP_DATA_DIR, () => app.getPath('userData'));
  ipcMain.handle(IPC.APP_RESET_FRESH, async () => {
    const args = process.argv
      .slice(1)
      .filter((arg) => arg !== '--sidelink-reset-fresh' && !arg.startsWith('sidelink://'));

    app.relaunch({ args: [...args, '--sidelink-reset-fresh'] });
    app.exit(0);
  });

  ipcMain.on(IPC.APP_QUIT, () => app.quit());
  ipcMain.on(IPC.APP_RELAUNCH, () => {
    app.relaunch();
    app.exit(0);
  });

  // ── Window controls ───────────────────────────────────────────────

  ipcMain.on(IPC.WIN_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IPC.WIN_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize();
    }
  });

  ipcMain.on(IPC.WIN_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(IPC.WIN_IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle(IPC.WIN_IS_FULLSCREEN, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
  });

  ipcMain.on(IPC.WIN_TOGGLE_DEVTOOLS, (event) => {
    const wc = event.sender;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  });

  // ── Native dialogs ────────────────────────────────────────────────

  ipcMain.handle(IPC.DIALOG_OPEN_FILE, async (event, opts?: DialogOpenFileOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const properties: Electron.OpenDialogOptions['properties'] = ['openFile'];
    if (opts?.multiple) properties.push('multiSelections');
    if (opts?.directory) properties.push('openDirectory');

    const dialogOpts: Electron.OpenDialogOptions = {
      title: opts?.title,
      filters: opts?.filters,
      properties,
    };

    const result = win
      ? await dialog.showOpenDialog(win, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);

    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle(IPC.DIALOG_SAVE_FILE, async (event, opts?: DialogSaveFileOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const dialogOpts: Electron.SaveDialogOptions = {
      title: opts?.title,
      defaultPath: opts?.defaultPath,
      filters: opts?.filters,
    };

    const result = win
      ? await dialog.showSaveDialog(win, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts);

    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle(IPC.DIALOG_MESSAGE, async (event, opts: DialogMessageOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const dialogOpts: Electron.MessageBoxOptions = {
      type: opts.type ?? 'info',
      title: opts.title,
      message: opts.message,
      detail: opts.detail,
      buttons: opts.buttons ?? ['OK'],
    };

    const result = win
      ? await dialog.showMessageBox(win, dialogOpts)
      : await dialog.showMessageBox(dialogOpts);

    return result.response;
  });

  // ── Shell operations ──────────────────────────────────────────────

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_event, url: string) => {
    // Security: only allow http/https URLs via proper URL parsing
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http/https URLs are allowed');
    }
    await shell.openExternal(parsed.href);
  });

  ipcMain.handle(IPC.SHELL_OPEN_PATH, async (_event, filepath: string) => {
    // Security: reject path traversal
    if (!filepath || filepath.includes('..')) {
      throw new Error('Invalid path');
    }
    return shell.openPath(filepath);
  });

  ipcMain.on(IPC.SHELL_SHOW_ITEM, (_event, filepath: string) => {
    if (!filepath || filepath.includes('..')) return;
    shell.showItemInFolder(filepath);
  });
}
