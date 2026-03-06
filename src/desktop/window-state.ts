// ─── Window State Persistence ────────────────────────────────────────
// Saves and restores BrowserWindow position/size across launches.
// Uses a simple JSON file in the app's userData directory.

import path from 'node:path';
import fs from 'node:fs';
import { app, type BrowserWindow, type Rectangle, screen } from 'electron';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

const STATE_FILE = 'window-state.json';
const DEFAULTS: WindowState = {
  width: 1360,
  height: 900,
  isMaximized: false,
};

function getStatePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE);
}

/**
 * Load saved window state from disk.
 * Falls back to defaults if file doesn't exist or is corrupt.
 */
export function loadWindowState(): WindowState {
  try {
    const raw = fs.readFileSync(getStatePath(), 'utf-8');
    const parsed = JSON.parse(raw) as WindowState;

    // Validate that the saved position is within a visible display
    if (parsed.x !== undefined && parsed.y !== undefined) {
      const visible = screen.getAllDisplays().some((display) => {
        const { x, y, width, height } = display.bounds;
        return (
          parsed.x! >= x &&
          parsed.x! < x + width &&
          parsed.y! >= y &&
          parsed.y! < y + height
        );
      });
      if (!visible) {
        // Position is offscreen (display was disconnected, etc.)
        delete parsed.x;
        delete parsed.y;
      }
    }

    return {
      ...DEFAULTS,
      ...parsed,
      width: Math.max(parsed.width ?? DEFAULTS.width, 800),
      height: Math.max(parsed.height ?? DEFAULTS.height, 500),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Save current window state to disk.
 */
export function saveWindowState(win: BrowserWindow): void {
  const isMaximized = win.isMaximized();
  // getNormalBounds() returns the non-maximized bounds on all platforms
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();

  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  };

  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2));
  } catch {
    // Non-critical, ignore write errors
  }
}

/**
 * Track window state changes and save on move/resize/maximize.
 */
export function trackWindowState(win: BrowserWindow): void {
  let saveTimeout: ReturnType<typeof setTimeout>;

  const debouncedSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveWindowState(win), 500);
  };

  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('maximize', () => saveWindowState(win));
  win.on('unmaximize', () => saveWindowState(win));
  win.on('close', () => {
    clearTimeout(saveTimeout);
    saveWindowState(win);
  });
}
