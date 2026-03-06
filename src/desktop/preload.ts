// ─── Electron Preload Script ─────────────────────────────────────────
// Exposes a safe, typed API to the renderer via contextBridge.
// The renderer accesses this via `window.sidelink`.
//
// SECURITY: Only specific IPC channels are exposed. No arbitrary
// node/electron access leaks into the renderer.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc-channels';
import type {
  UpdaterEvent,
  DialogOpenFileOptions,
  DialogSaveFileOptions,
  DialogMessageOptions,
} from './ipc-channels';

// ── Build the API surface ────────────────────────────────────────────

const electronAPI = {
  // ── App info ──────────────────────────────────────────────────────
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_VERSION),
  getPlatform: (): Promise<string> => ipcRenderer.invoke(IPC.APP_PLATFORM),
  isPackaged: (): Promise<boolean> => ipcRenderer.invoke(IPC.APP_IS_PACKAGED),
  getDataDir: (): Promise<string> => ipcRenderer.invoke(IPC.APP_DATA_DIR),
  quit: (): void => ipcRenderer.send(IPC.APP_QUIT),
  relaunch: (): void => ipcRenderer.send(IPC.APP_RELAUNCH),

  // ── Window controls ───────────────────────────────────────────────
  minimize: (): void => ipcRenderer.send(IPC.WIN_MINIMIZE),
  maximize: (): void => ipcRenderer.send(IPC.WIN_MAXIMIZE),
  close: (): void => ipcRenderer.send(IPC.WIN_CLOSE),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.WIN_IS_MAXIMIZED),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke(IPC.WIN_IS_FULLSCREEN),
  toggleDevTools: (): void => ipcRenderer.send(IPC.WIN_TOGGLE_DEVTOOLS),

  // ── Auto-updater ──────────────────────────────────────────────────
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_CHECK),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
  installUpdate: (): void => ipcRenderer.send(IPC.UPDATER_INSTALL),
  onUpdaterEvent: (callback: (event: UpdaterEvent) => void): (() => void) => {
    const handler = (_: unknown, data: UpdaterEvent) => callback(data);
    ipcRenderer.on(IPC.UPDATER_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.UPDATER_EVENT, handler);
  },

  // ── Native dialogs ────────────────────────────────────────────────
  openFile: (opts?: DialogOpenFileOptions): Promise<string[] | null> =>
    ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE, opts),
  saveFile: (opts?: DialogSaveFileOptions): Promise<string | null> =>
    ipcRenderer.invoke(IPC.DIALOG_SAVE_FILE, opts),
  showMessage: (opts: DialogMessageOptions): Promise<number> =>
    ipcRenderer.invoke(IPC.DIALOG_MESSAGE, opts),

  // ── Shell ─────────────────────────────────────────────────────────
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),
  openPath: (filepath: string): Promise<string> => ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, filepath),
  showItemInFolder: (filepath: string): void => ipcRenderer.send(IPC.SHELL_SHOW_ITEM, filepath),

  // ── Push notifications from main ──────────────────────────────────
  onInstallComplete: (cb: (data: { appName: string; deviceName: string }) => void): (() => void) => {
    const handler = (_: unknown, data: { appName: string; deviceName: string }) => cb(data);
    ipcRenderer.on(IPC.NOTIFY_INSTALL_COMPLETE, handler);
    return () => ipcRenderer.removeListener(IPC.NOTIFY_INSTALL_COMPLETE, handler);
  },
  onDeviceConnected: (cb: (data: { name: string; udid: string }) => void): (() => void) => {
    const handler = (_: unknown, data: { name: string; udid: string }) => cb(data);
    ipcRenderer.on(IPC.NOTIFY_DEVICE_CONNECTED, handler);
    return () => ipcRenderer.removeListener(IPC.NOTIFY_DEVICE_CONNECTED, handler);
  },

  // ── Deep link navigation (main → renderer) ─────────────────────────
  onDeepLink: (cb: (data: { action: string; params: Record<string, string> }) => void): (() => void) => {
    const handler = (_: unknown, data: { action: string; params: Record<string, string> }) => cb(data);
    ipcRenderer.on(IPC.DEEP_LINK, handler);
    return () => ipcRenderer.removeListener(IPC.DEEP_LINK, handler);
  },

  /** True when running inside Electron (renderer can check this) */
  isElectron: true as const,
};

export type SidelinkElectronAPI = typeof electronAPI;

// ── Expose to renderer ──────────────────────────────────────────────
contextBridge.exposeInMainWorld('sidelink', electronAPI);
