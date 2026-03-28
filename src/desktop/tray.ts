// ─── System Tray ─────────────────────────────────────────────────────
// Creates a tray icon with context menu for quick access.
// On macOS uses a template image (dark/light mode compatible).

import fs from 'node:fs';
import path from 'node:path';
import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import { IPC } from './ipc-channels';
import { checkForUpdates } from './auto-updater';

let tray: Tray | null = null;
let showWindowAction: (() => void) | null = null;
let navigateAction: ((action: string) => void) | null = null;
let hideToTrayAction: (() => void) | null = null;
let isWindowVisibleFn: (() => boolean) | null = null;

type TrayActions = {
  showWindow?: () => void;
  navigate?: (action: string) => void;
  hideToTray?: () => void;
  isWindowVisible?: () => boolean;
};

/**
 * Resolve the tray icon path based on platform and packaging state.
 */
function getTrayIconPath(): string {
  const iconsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'icons')
    : path.join(__dirname, '../../build/icons');

  if (process.platform === 'darwin') {
    // macOS template icon: 16×16 or 22×22 @2x
    return path.join(iconsDir, 'icon.iconset', 'icon_16x16.png');
  }
  if (process.platform === 'win32') {
    return path.join(iconsDir, 'icon.ico');
  }
  // Linux
  return path.join(iconsDir, 'icon.iconset', 'icon_32x32.png');
}

/**
 * Focus or create the main window when the user clicks the tray icon.
 */
function focusMainWindow(): void {
  if (showWindowAction) {
    showWindowAction();
    return;
  }
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    const win = windows[0];
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function navigateFromTray(action: string): void {
  if (navigateAction) {
    navigateAction(action);
    return;
  }
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) return;
  const win = windows[0];
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send(IPC.DEEP_LINK, { action, params: {} });
}

/**
 * Create the system tray icon with context menu.
 * Returns the Tray instance (call `destroy()` on shutdown).
 */
export function createTray(actions?: TrayActions): Tray {
  showWindowAction = actions?.showWindow ?? showWindowAction;
  navigateAction = actions?.navigate ?? navigateAction;
  hideToTrayAction = actions?.hideToTray ?? hideToTrayAction;
  isWindowVisibleFn = actions?.isWindowVisible ?? isWindowVisibleFn;
  if (tray) return tray;

  const iconPath = getTrayIconPath();
  if (!fs.existsSync(iconPath)) {
    console.warn(`[tray] Icon not found at ${iconPath}, using fallback`);
  }
  let icon: Electron.NativeImage;

  try {
    icon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') {
      icon = icon.resize({ width: 16, height: 16 });
      icon.setTemplateImage(true);
    }
  } catch {
    // Fallback: create an empty 16×16 icon
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('SideLink — iOS App Manager');

  updateTrayMenu();

  tray.on('click', () => {
    focusMainWindow();
  });

  tray.on('double-click', () => {
    focusMainWindow();
  });

  return tray;
}

/**
 * Update the tray context menu (call after state changes).
 */
export function updateTrayMenu(extra?: { deviceCount?: number; jobsRunning?: number; jobsWaiting2FA?: number }): void {
  if (!tray) return;

  const deviceLabel = extra?.deviceCount !== undefined
    ? `Devices Connected: ${extra.deviceCount}`
    : 'Devices: —';

  const activeJobCount = (extra?.jobsRunning ?? 0) + (extra?.jobsWaiting2FA ?? 0);
  const jobLabel = activeJobCount > 0
    ? `Active Jobs: ${activeJobCount}`
    : 'No Active Jobs';

  const twoFALabel = extra?.jobsWaiting2FA && extra.jobsWaiting2FA > 0
    ? `Waiting for 2FA: ${extra.jobsWaiting2FA}`
    : 'No 2FA Pending';

  const statusLabel = (extra?.jobsWaiting2FA ?? 0) > 0
    ? 'Status: Waiting for Input'
    : (extra?.jobsRunning ?? 0) > 0
      ? 'Status: Busy'
      : 'Status: Idle';

  const windowVisible = isWindowVisibleFn ? isWindowVisibleFn() : true;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open SideLink',
      click: focusMainWindow,
    },
    {
      label: windowVisible ? 'Hide to Tray' : 'Show Window',
      click: () => {
        if (windowVisible && hideToTrayAction) {
          hideToTrayAction();
        } else {
          focusMainWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Go to Install',
      click: () => navigateFromTray('install'),
    },
    {
      label: 'Go to Devices',
      click: () => navigateFromTray('devices'),
    },
    {
      label: 'Go to Settings',
      click: () => navigateFromTray('settings'),
    },
    { type: 'separator' },
    {
      label: deviceLabel,
      enabled: false,
    },
    {
      label: jobLabel,
      enabled: false,
    },
    {
      label: twoFALabel,
      enabled: false,
    },
    {
      label: statusLabel,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Check for Updates…',
      click: () => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
          wins[0].webContents.send(IPC.UPDATER_EVENT, { type: 'checking' });
        }
        void checkForUpdates().catch(() => {
          // updater is optional in development builds
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit SideLink',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Destroy the tray icon (call on shutdown).
 */
export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
