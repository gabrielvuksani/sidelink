// ─── Keyboard Shortcuts Hook ─────────────────────────────────────────
// Global keyboard shortcut handling for the Sidelink client.
// Supports Cmd/Ctrl modifiers, navigation, and action shortcuts.

import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/** Shortcut definition */
interface Shortcut {
  /** Key code (e.g. 'k', '/', '1') */
  key: string;
  /** Require Cmd (macOS) / Ctrl (Windows/Linux) */
  meta?: boolean;
  /** Require Shift */
  shift?: boolean;
  /** Action to perform */
  action: () => void;
  /** Description (for help display) */
  label: string;
}

const isMac = navigator.platform?.toLowerCase().includes('mac') ?? false;

/**
 * Register a set of keyboard shortcuts. Active while component is mounted.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      // Skip when typing in input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      for (const s of shortcuts) {
        const metaMatch = s.meta
          ? (isMac ? e.metaKey : e.ctrlKey)
          : !(isMac ? e.metaKey : e.ctrlKey);
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;

        if (e.key.toLowerCase() === s.key.toLowerCase() && metaMatch && shiftMatch) {
          e.preventDefault();
          s.action();
          return;
        }
      }
    },
    [shortcuts],
  );

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}

/**
 * Default navigation shortcuts for the main layout.
 * Uses number keys 1-8 (with Cmd/Ctrl) for nav items + other global shortcuts.
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate();

  const shortcuts: Shortcut[] = [
    // Navigation (Cmd/Ctrl + 1-8)
    { key: '1', meta: true, action: () => navigate('/'),          label: 'Go to Dashboard' },
    { key: '2', meta: true, action: () => navigate('/apple'),     label: 'Go to Apple ID' },
    { key: '3', meta: true, action: () => navigate('/devices'),   label: 'Go to Devices' },
    { key: '4', meta: true, action: () => navigate('/apps'),      label: 'Go to IPAs' },
    { key: '5', meta: true, action: () => navigate('/install'),   label: 'Go to Install' },
    { key: '6', meta: true, action: () => navigate('/installed'), label: 'Go to Installed' },
    { key: '7', meta: true, action: () => navigate('/logs'),      label: 'Go to Logs' },
    { key: '8', meta: true, action: () => navigate('/settings'),  label: 'Go to Settings' },
  ];

  useKeyboardShortcuts(shortcuts);
}
