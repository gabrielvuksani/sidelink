import type { ReactNode } from 'react';

export function Field({
  htmlFor,
  label,
  hint,
  children,
}: {
  htmlFor?: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]">
          {label}
        </label>
        {hint && <span className="text-[11px] text-[var(--sl-muted)]/80">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function InlineNotice({
  title,
  children,
  tone = 'default',
}: {
  title: string;
  children: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    default: 'border-white/8 bg-white/[0.03] text-[#c5d7e0]',
    success: 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100',
    warning: 'border-amber-400/18 bg-amber-400/[0.07] text-amber-100',
    danger: 'border-red-400/18 bg-red-400/[0.08] text-red-100',
  }[tone];

  return (
    <div className={`rounded-2xl border px-4 py-4 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">{title}</p>
      <div className="mt-2 text-[13px] leading-6">{children}</div>
    </div>
  );
}

export function StepActions({
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled = false,
  loading = false,
  showSkip = false,
  onSkip,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
  showSkip?: boolean;
  onSkip?: () => void;
}) {
  return (
    <div className="mt-8 flex items-center justify-between gap-4 border-t border-white/6 pt-5">
      <div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-text)]"
          >
            &larr; Back
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        {showSkip && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="text-sm font-medium text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-text)]"
          >
            Skip for now
          </button>
        )}
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || loading}
          className="sl-btn-primary flex items-center gap-2"
        >
          {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
