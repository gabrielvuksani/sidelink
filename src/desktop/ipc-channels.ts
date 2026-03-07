// ─── IPC Channel Definitions ─────────────────────────────────────────
// Single source of truth for all Electron IPC channel names and their
// request/response types. Shared between main process and preload.

export const IPC = {
  // ── App lifecycle ──────────────────────────────────────────────────
  APP_VERSION: 'app:version',
  APP_PLATFORM: 'app:platform',
  APP_QUIT: 'app:quit',
  APP_RELAUNCH: 'app:relaunch',
  APP_IS_PACKAGED: 'app:isPackaged',
  APP_DATA_DIR: 'app:dataDir',
  APP_RESET_FRESH: 'app:resetFresh',

  // ── Window management ──────────────────────────────────────────────
  WIN_MINIMIZE: 'win:minimize',
  WIN_MAXIMIZE: 'win:maximize',
  WIN_CLOSE: 'win:close',
  WIN_IS_MAXIMIZED: 'win:isMaximized',
  WIN_IS_FULLSCREEN: 'win:isFullscreen',
  WIN_TOGGLE_DEVTOOLS: 'win:toggleDevTools',

  // ── Auto-updater ──────────────────────────────────────────────────
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  /** Main → renderer push event */
  UPDATER_EVENT: 'updater:event',

  // ── Native dialogs ────────────────────────────────────────────────
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_SAVE_FILE: 'dialog:saveFile',
  DIALOG_MESSAGE: 'dialog:message',

  // ── Shell ─────────────────────────────────────────────────────────
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  SHELL_OPEN_PATH: 'shell:openPath',
  SHELL_SHOW_ITEM: 'shell:showItemInFolder',

  // ── Notifications (main → renderer) ────────────────────────────────
  NOTIFY_INSTALL_COMPLETE: 'notify:installComplete',
  NOTIFY_DEVICE_CONNECTED: 'notify:deviceConnected',
  // ── Deep links (main → renderer) ──────────────────────
  DEEP_LINK: 'deep-link',} as const;

// ── Type-safe request/response shapes ────────────────────────────────

export interface UpdaterEvent {
  type: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: {
    version?: string;
    releaseDate?: string;
    percent?: number;
    bytesPerSecond?: number;
    total?: number;
    transferred?: number;
  };
  error?: string;
}

export interface DialogOpenFileOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  multiple?: boolean;
  directory?: boolean;
}

export interface DialogSaveFileOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface DialogMessageOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  title?: string;
  message: string;
  detail?: string;
  buttons?: string[];
}
