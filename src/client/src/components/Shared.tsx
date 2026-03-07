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
