// ─── Native Menu ─────────────────────────────────────────────────────
// Sets up the native application menu with platform-appropriate
// keyboard shortcuts and menu structure.

import { app, Menu, BrowserWindow, shell } from 'electron';
import { IPC } from './ipc-channels';
import { checkForUpdates } from './auto-updater';

const isMac = process.platform === 'darwin';

function getMainWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) return focused;
  const all = BrowserWindow.getAllWindows();
  return all.length > 0 ? all[0] : null;
}

function sendRoute(action: string): void {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send(IPC.DEEP_LINK, { action, params: {} });
}

/**
 * Build and set the native application menu.
 */
export function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [];

  // ── macOS App Menu ────────────────────────────────────────────────
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => {
            void checkForUpdates().catch(() => {
              // updater is optional in development builds
            });
          },
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendRoute('settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  // ── File Menu ─────────────────────────────────────────────────────
  template.push({
    label: 'File',
    submenu: [
      {
        label: 'Dashboard',
        accelerator: 'CmdOrCtrl+1',
        click: () => sendRoute('dashboard'),
      },
      {
        label: 'Install',
        accelerator: 'CmdOrCtrl+5',
        click: () => sendRoute('install'),
      },
      {
        label: 'Devices',
        accelerator: 'CmdOrCtrl+3',
        click: () => sendRoute('devices'),
      },
      { type: 'separator' },
      {
        label: isMac ? 'Hide to Tray' : 'Minimize to Tray',
        accelerator: isMac ? 'Cmd+M' : 'Ctrl+M',
        click: () => {
          const win = getMainWindow();
          if (win) win.hide();
        },
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  });

  template.push({
    label: 'Navigate',
    submenu: [
      { label: 'Overview', accelerator: 'CmdOrCtrl+1', click: () => sendRoute('dashboard') },
      { label: 'Apple ID', accelerator: 'CmdOrCtrl+2', click: () => sendRoute('apple') },
      { label: 'Devices', accelerator: 'CmdOrCtrl+3', click: () => sendRoute('devices') },
      { label: 'IPAs', accelerator: 'CmdOrCtrl+4', click: () => sendRoute('apps') },
      { label: 'Install', accelerator: 'CmdOrCtrl+5', click: () => sendRoute('install') },
      { label: 'Installed', accelerator: 'CmdOrCtrl+6', click: () => sendRoute('installed') },
      { label: 'Logs', accelerator: 'CmdOrCtrl+7', click: () => sendRoute('logs') },
      { label: 'Settings', accelerator: 'CmdOrCtrl+8', click: () => sendRoute('settings') },
    ],
  });

  // ── Edit Menu ─────────────────────────────────────────────────────
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? [
            { role: 'pasteAndMatchStyle' as const },
            { role: 'delete' as const },
            { role: 'selectAll' as const },
          ]
        : [
            { role: 'delete' as const },
            { type: 'separator' as const },
            { role: 'selectAll' as const },
          ]),
    ],
  });

  // ── View Menu ─────────────────────────────────────────────────────
  template.push({
    label: 'View',
    submenu: [
      {
        label: 'Reload Dashboard Data',
        accelerator: 'CmdOrCtrl+R',
        click: () => {
          const win = getMainWindow();
          if (win) win.webContents.reloadIgnoringCache();
        },
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  // ── Window Menu ───────────────────────────────────────────────────
  template.push({
    label: 'Window',
    submenu: [
      {
        label: 'Show SideLink',
        accelerator: isMac ? 'CmdOrCtrl+Shift+S' : 'Ctrl+Shift+S',
        click: () => {
          const win = getMainWindow();
          if (!win) return;
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        },
      },
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' as const },
            { role: 'front' as const },
          ]
        : [{ role: 'close' as const }]),
    ],
  });

  // ── Help Menu ─────────────────────────────────────────────────────
  template.push({
    role: 'help',
    submenu: [
      {
        label: 'SideLink Documentation',
        click: () => shell.openExternal('https://github.com/gabrielvuksani/sidelink'),
      },
      {
        label: 'Report an Issue',
        click: () => shell.openExternal('https://github.com/gabrielvuksani/sidelink/issues'),
      },
      { type: 'separator' },
      {
        label: 'Open Data Directory',
        click: () => shell.openPath(app.getPath('userData')),
      },
    ],
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
