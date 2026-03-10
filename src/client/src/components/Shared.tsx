import { useState } from 'react';
import type { ReactNode } from 'react';

// ─── Shared UI Components ────────────────────────────────────────────

type Tone = 'teal' | 'amber' | 'sky' | 'rose' | 'slate' | 'lime';

const toneMap: Record<Tone, string> = {
  teal: 'border-teal-300/15 bg-teal-300/10 text-teal-100',
  amber: 'border-amber-300/15 bg-amber-300/10 text-amber-100',
  sky: 'border-sky-300/15 bg-sky-300/10 text-sky-100',
  rose: 'border-rose-300/15 bg-rose-300/10 text-rose-100',
  slate: 'border-white/10 bg-white/[0.04] text-slate-100',
  lime: 'border-lime-300/15 bg-lime-300/10 text-lime-100',
};

/** Loading spinner */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--sl-accent)] border-t-transparent" />
    </div>
  );
}

/** Full-page centered spinner with optional message */
export function PageLoader({ message }: { message?: string }) {
  return (
    <div className="sl-card flex flex-col items-center justify-center gap-3 py-24 animate-fadeIn">
      <Spinner />
      {message && <p className="text-[13px] text-[var(--sl-muted)]">{message}</p>}
    </div>
  );
}

/** Status badge for job/pipeline status */
export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: 'bg-white/[0.05] text-[var(--sl-muted)]',
    running: 'bg-indigo-500/10 text-indigo-400',
    completed: 'bg-emerald-500/10 text-emerald-400',
    failed: 'bg-red-500/10 text-red-400',
    waiting_2fa: 'bg-amber-500/10 text-amber-400',
    active: 'bg-emerald-500/10 text-emerald-400',
    requires_2fa: 'bg-amber-500/10 text-amber-400',
    session_expired: 'bg-red-500/10 text-red-400',
    locked: 'bg-red-500/10 text-red-400',
    unauthenticated: 'bg-white/[0.04] text-[var(--sl-muted)]',
  };
  return (
    <span
      className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-md ${colors[status] ?? 'bg-white/[0.05] text-[var(--sl-muted)]'}`}
    >
      {status === 'running' && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />}
      {status === 'waiting_2fa' && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />}
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/** Empty state placeholder */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="sl-card flex flex-col items-center px-8 py-16 text-center animate-fadeIn">
      {icon && <div className="mb-4 text-[var(--sl-muted)] opacity-40">{icon}</div>}
      <p className="text-[15px] font-semibold text-[var(--sl-text)]">{title}</p>
      {description && <p className="mt-1.5 text-[13px] text-[var(--sl-muted)] max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  stats,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  stats?: Array<{ label: string; value: ReactNode; tone?: Tone }>;
}) {
  return (
    <section className="sl-page-hero animate-fadeIn">
      <div className="sl-page-hero-inner">
        <div>
          <p className="sl-kicker">{eyebrow}</p>
          <h1 className="sl-page-title">{title}</h1>
          <div className="sl-page-copy">{description}</div>
          {actions && <div className="sl-toolbar mt-5">{actions}</div>}
        </div>

        {stats && stats.length > 0 && (
          <div className="sl-hero-metrics">
            {stats.map((stat) => (
              <HeroMetric key={String(stat.label)} label={stat.label} value={stat.value} tone={stat.tone ?? 'slate'} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function HeroMetric({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`sl-hero-metric ${toneMap[tone]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">{label}</p>
      <div className="mt-2 text-[15px] font-semibold tracking-tight">{value}</div>
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="sl-section-label">{eyebrow}</p>}
        <h2 className="mt-1 text-[1.1rem] font-semibold tracking-tight text-[var(--sl-text)]">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-6 text-[var(--sl-muted)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function InfoPill({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={`sl-chip ${toneMap[tone]}`}>{children}</span>;
}

/** Section card wrapper */
export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`sl-card ${className}`}>
      {children}
    </div>
  );
}

/** Pipeline step status icon — used in InstallModal and InstallPage */
export function StepIcon({ status }: { status: string }) {
  if (status === 'completed') return <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  if (status === 'running') return <span className="w-4 h-4 flex items-center justify-center"><span className="w-2.5 h-2.5 bg-[var(--sl-accent)] rounded-full animate-pulse" /></span>;
  if (status === 'waiting_2fa') return <svg className="w-4 h-4 text-amber-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>;
  if (status === 'failed') return <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  return <span className="w-4 h-4 flex items-center justify-center"><span className="w-2.5 h-2.5 border border-[var(--sl-muted)] rounded-full" /></span>;
}

/** Reusable progress bar with color tones */
export function ProgressBar({
  ratio,
  className = '',
}: {
  ratio: number;
  className?: string;
}) {
  const toneClass = ratio >= 1 ? 'bg-red-400' : ratio >= 0.8 ? 'bg-amber-400' : 'bg-[var(--sl-accent)]';
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-[var(--sl-bg)] ${className}`}>
      <div className={`h-full rounded-full transition-all duration-300 ${toneClass}`} style={{ width: `${Math.round(Math.min(ratio, 1) * 100)}%` }} />
    </div>
  );
}

/** Accessible toggle switch */
export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--sl-accent)]/40 ${
        checked ? 'bg-[var(--sl-accent)]' : 'bg-[var(--sl-surface-raised)]'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

/** Skeleton loading placeholder */
export function SkeletonBlock({
  className = 'h-5 w-32',
}: {
  className?: string;
}) {
  return <div className={`animate-pulse rounded-lg bg-[var(--sl-surface-soft)] ${className}`} />;
}

/** Skeleton card for page-level loading */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="sl-card p-5 space-y-3 animate-fadeIn">
      <SkeletonBlock className="h-4 w-40" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} className={`h-3 ${i === lines - 1 ? 'w-3/5' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** Format a timestamp into a human-friendly relative time string */
export function relativeTime(dateInput: string | number | Date): string {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}

/** Password input with show/hide toggle */
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
  required,
  className = '',
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
        className={`sl-input pr-10 ${className}`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--sl-muted)] hover:text-[var(--sl-text)] transition-colors"
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {visible ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
        ) : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        )}
      </button>
    </div>
  );
}
