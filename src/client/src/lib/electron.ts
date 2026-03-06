// ─── Electron Bridge (Client-Side) ───────────────────────────────────
// Type-safe access to the `window.sidelink` API exposed by the preload
// script. Falls back gracefully when running in a regular browser.

// ── Type definition for the preload API ──────────────────────────────
// Duplicated here because the client tsconfig can't reach desktop/.
// Keep in sync with src/desktop/preload.ts.

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

export interface SidelinkElectronAPI {
  // App info
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;
  isPackaged(): Promise<boolean>;
  getDataDir(): Promise<string>;
  quit(): void;
  relaunch(): void;

  // Window controls
  minimize(): void;
  maximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  toggleDevTools(): void;

  // Auto-updater
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): void;
  onUpdaterEvent(callback: (event: UpdaterEvent) => void): () => void;

  // Native dialogs
  openFile(opts?: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; multiple?: boolean; directory?: boolean }): Promise<string[] | null>;
  saveFile(opts?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  showMessage(opts: { type?: string; title?: string; message: string; detail?: string; buttons?: string[] }): Promise<number>;

  // Shell
  openExternal(url: string): Promise<void>;
  openPath(filepath: string): Promise<string>;
  showItemInFolder(filepath: string): void;

  // Push notifications
  onInstallComplete(cb: (data: { appName: string; deviceName: string }) => void): () => void;
  onDeviceConnected(cb: (data: { name: string; udid: string }) => void): () => void;

  // Deep links
  onDeepLink(cb: (data: { action: string; params: Record<string, string> }) => void): () => void;

  isElectron: true;
}

declare global {
  interface Window {
    sidelink?: SidelinkElectronAPI;
  }
}

/**
 * True when the app is running inside Electron (preload bridge loaded).
 */
export const isElectron: boolean = !!window.sidelink?.isElectron;

/**
 * Access the Electron API. Returns null when running in a browser.
 */
export function getElectronAPI(): SidelinkElectronAPI | null {
  return window.sidelink ?? null;
}

/**
 * Open a URL in the user's default browser.
 * In Electron → shell.openExternal; in browser → window.open.
 */
export function openExternal(url: string): void {
  const api = getElectronAPI();
  if (api) {
    void api.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Show a native file open dialog (Electron only).
 * Returns null in browser mode.
 */
export async function pickFile(opts?: {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string[] | null> {
  const api = getElectronAPI();
  if (!api) return null;
  return api.openFile({
    title: opts?.title ?? 'Select File',
    filters: opts?.filters,
    multiple: false,
  });
}

/**
 * Pick an IPA file specifically.
 */
export async function pickIpaFile(): Promise<string | null> {
  const paths = await pickFile({
    title: 'Select IPA File',
    filters: [{ name: 'iOS App', extensions: ['ipa'] }],
  });
  return paths?.[0] ?? null;
}
