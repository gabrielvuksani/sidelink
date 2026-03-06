// ─── Confirm Modal ───────────────────────────────────────────────────
// Drop-in replacement for window.confirm() that matches the dark theme.

import { useState, useCallback, useEffect, createContext, useContext, useRef } from 'react';
import type { ReactNode } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmCtx {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmCtx>({ confirm: () => Promise.resolve(false) });

export function useConfirm() {
  return useContext(ConfirmContext).confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setDialog({ ...opts, resolve });
    });
  }, []);

  const close = (result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setDialog(null);
  };

  return (
    <ConfirmContext value={{ confirm }}>
      {children}
      {dialog && (
        <ConfirmDialog dialog={dialog} onClose={close} />
      )}
    </ConfirmContext>
  );
}

function ConfirmDialog({
  dialog,
  onClose,
}: {
  dialog: ConfirmOptions & { resolve: (v: boolean) => void };
  onClose: (result: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = 'confirm-dialog-title';
  const descId = 'confirm-dialog-desc';

  // Trap focus inside dialog and close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose(false);
        return;
      }
      if (e.key === 'Tab') {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div
        ref={panelRef}
        className="sl-card p-6 max-w-sm w-full mx-4 shadow-2xl animate-scaleIn"
      >
        <h3 id={titleId} className="text-[var(--sl-text)] font-semibold mb-2">{dialog.title}</h3>
        <p id={descId} className="text-[var(--sl-muted)] text-[13px] mb-6">{dialog.message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => onClose(false)}
            className="sl-btn-ghost"
          >
            Cancel
          </button>
          <button
            onClick={() => onClose(true)}
            autoFocus
            className={dialog.danger ? 'sl-btn-danger' : 'sl-btn-primary'}
          >
            {dialog.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
