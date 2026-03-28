// ─── Confirm Modal ───────────────────────────────────────────────────
// Drop-in replacement for window.confirm() that matches the dark theme.

import { useState, useCallback, useEffect, createContext, useContext, useRef, useId } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
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
  const titleId = useId();
  const descId = useId();

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

  useBodyScrollLock(true);

  return (
    <div
      className="sl-modal-overlay z-[95] animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div className="sl-modal-frame">
        <div
          ref={panelRef}
          className="sl-modal-panel sl-card w-full max-w-sm overflow-hidden p-0 shadow-2xl animate-scaleIn"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6">
            <h3 id={titleId} className="text-[1.05rem] font-semibold tracking-[-0.02em] text-[var(--sl-text)]">{dialog.title}</h3>
            <p id={descId} className="mt-2 text-[13px] leading-6 text-[var(--sl-muted)]">{dialog.message}</p>
          </div>
          <div className="shrink-0 flex justify-end gap-3 border-t border-[var(--sl-border)] px-5 py-4 sm:px-6">
            <button
              onClick={() => onClose(false)}
              className="sl-btn-ghost justify-center"
            >
              Cancel
            </button>
            <button
              onClick={() => onClose(true)}
              autoFocus
              className={`${dialog.danger ? 'sl-btn-danger' : 'sl-btn-primary'} justify-center`}
            >
              {dialog.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
