import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { formatJobError } from '../lib/errors';
import { useSSE } from '../hooks/useSSE';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { useInstallModal } from '../components/InstallModal';
import { StatusBadge, PageHeader, PageLoader, SectionHeading } from '../components/Shared';
import type { InstallJob, JobLogEntry, PipelineStep } from '../../../shared/types';
import { UI_LIMITS } from '../../../shared/constants';

export default function InstallPage() {
  const [jobs, setJobs] = useState<InstallJob[]>([]);
  const [jobLogs, setJobLogs] = useState<Record<string, JobLogEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { openInstall } = useInstallModal();

  useEffect(() => { document.title = 'Install — SideLink'; }, []);

  const reload = useCallback(async () => {
    try {
      const res = await api.listJobs();
      setJobs(res.data ?? []);
    } catch {
      toast('error', 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  usePageRefresh(reload);

  const hydrateJobLogs = useCallback(async (jobId: string) => {
    try {
      const response = await api.getJobLogs(jobId);
      setJobLogs((prev) => ({ ...prev, [jobId]: response.data ?? [] }));
    } catch {
      // Job logs are best-effort; ignore failures.
    }
  }, []);

  useEffect(() => {
    for (const job of jobs) {
      if (jobLogs[job.id]) continue;
      void hydrateJobLogs(job.id);
    }
  }, [jobs, jobLogs, hydrateJobLogs]);

  useSSE({
    'job-update': (data) => {
      const job = data as InstallJob;
      setJobs(prev => {
        const idx = prev.findIndex(j => j.id === job.id);
        if (idx >= 0) return prev.map(j => j.id === job.id ? job : j);
        return [job, ...prev];
      });
    },
    'job-log': (data) => {
      const entry = data as JobLogEntry;
      if (!entry?.jobId) return;
      setJobLogs((prev) => ({
        ...prev,
        [entry.jobId]: [...(prev[entry.jobId] ?? []), entry].slice(-UI_LIMITS.maxJobLogEntries),
      }));
    },
  });

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'waiting_2fa');
  const completedJobs = jobs.filter(j => j.status !== 'running' && j.status !== 'waiting_2fa');
  const waiting2FA = activeJobs.filter((job) => job.status === 'waiting_2fa').length;

  if (loading) return <PageLoader message="Loading..." />;

  return (
    <div className="sl-page animate-fadeIn">
      <PageHeader
        eyebrow="Install Pipeline"
        title="Launch, monitor, and recover installs without leaving the page"
        description="The install view now works like an operations console: queue a new install, respond to 2FA, and review history in one continuous desktop workflow."
        actions={(
          <button onClick={() => openInstall()} className="sl-btn-primary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            New Install
          </button>
        )}
        stats={[
          { label: 'Active Jobs', value: activeJobs.length, tone: activeJobs.length > 0 ? 'teal' : 'slate' },
          { label: '2FA Required', value: waiting2FA, tone: waiting2FA > 0 ? 'amber' : 'slate' },
          { label: 'Completed Jobs', value: completedJobs.length, tone: 'sky' },
        ]}
      />

      {activeJobs.length > 0 && (
        <div className="space-y-3">
          <SectionHeading eyebrow="Live Work" title="Active installs" description="Running jobs stay pinned at the top so 2FA and failure states are never buried in history." />
          {activeJobs.map(job => (
            <ActiveJobCard key={job.id} job={job} logs={jobLogs[job.id] ?? []} />
          ))}
        </div>
      )}

      {jobs.length === 0 && (
        <div className="text-center py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--sl-surface-soft)] mx-auto mb-4">
            <svg className="w-7 h-7 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
          </div>
          <p className="text-[var(--sl-text)] text-[13px] font-semibold">No installations yet</p>
          <p className="text-[var(--sl-muted)] text-[12px] mt-1 mb-4">Click "New Install" to get started</p>
          <button onClick={() => openInstall()} className="sl-btn-primary">Start Installing</button>
        </div>
      )}

      {completedJobs.length > 0 && (
        <div>
          <SectionHeading eyebrow="Archive" title="Recent install history" description="Completed and failed runs stay visible with their latest error summaries for quick support and retry decisions." />
          <div className="sl-card divide-y divide-[var(--sl-border)]">
            {completedJobs.slice(0, 15).map(j => {
              const isFailed = j.status === 'failed';
              const formatted = isFailed && j.error ? formatJobError(j.error) : null;
              return (
                <div key={j.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[11px] text-[var(--sl-muted)] font-mono">{j.id.slice(0, 8)}</span>
                      <span className="text-[12px] text-[var(--sl-muted)]">{j.currentStep ?? '-'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {formatted && (
                        <span className="text-[11px] text-red-400/70 truncate max-w-[220px]">{formatted.title}</span>
                      )}
                      <StatusBadge status={j.status} />
                    </div>
                  </div>
                  {formatted && (
                    <p className="text-[11px] text-[var(--sl-muted)] mt-1.5 leading-relaxed">{formatted.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveJobCard({ job, logs }: { job: InstallJob; logs: JobLogEntry[] }) {
  const steps = job.steps ?? [];
  const [twoFACode, setTwoFACode] = useState('');
  const [submitting2FA, setSubmitting2FA] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const { toast } = useToast();

  const handle2FASubmit = async () => {
    if (!twoFACode.trim()) return;
    setSubmitting2FA(true);
    try {
      await api.submitJob2FA(job.id, twoFACode.trim());
      toast('success', '2FA code submitted');
      setTwoFACode('');
    } catch (e: unknown) {
      toast('error', (e as Error)?.message ?? '2FA submission failed');
    } finally {
      setSubmitting2FA(false);
    }
  };

  return (
    <div className="sl-card !border-indigo-500/15 !bg-indigo-500/[0.03] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-[var(--sl-accent)] rounded-full animate-pulse" />
          <span className="text-[13px] text-indigo-300 font-semibold">Installing</span>
          <span className="text-[11px] text-[var(--sl-muted)] font-mono ml-1">{job.id.slice(0, 8)}</span>
        </div>
        <StatusBadge status={job.status} />
      </div>

      <div className="space-y-1.5">
        {steps.map((step: PipelineStep, i: number) => (
          <div key={i} className="flex items-center gap-2.5">
            <StepIcon status={step.status === 'running' && job.status === 'waiting_2fa' ? 'waiting_2fa' : step.status} />
            <span className={`text-[13px] ${step.status === 'running' ? (job.status === 'waiting_2fa' ? 'text-amber-400' : 'text-indigo-400') : step.status === 'completed' ? 'text-emerald-400' : step.status === 'failed' ? 'text-red-400' : 'text-[var(--sl-muted)]'}`}>
              {step.name}
            </span>
            {step.error && (
              <span className="text-[11px] text-red-400/70 ml-auto truncate max-w-xs" title={step.error}>
                {formatJobError(step.error).title}
              </span>
            )}
          </div>
        ))}
      </div>

      {job.status === 'waiting_2fa' && (
        <div className="mt-4 sl-card !border-amber-500/15 !bg-amber-500/[0.04] p-4">
          <p className="text-amber-300 text-[13px] font-semibold mb-2">2FA Required</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={twoFACode}
              onChange={e => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && handle2FASubmit()}
              placeholder="000000"
              maxLength={6}
              autoFocus
              className="sl-input flex-1 text-center text-lg font-mono tracking-[0.3em]"
            />
            <button onClick={handle2FASubmit} disabled={twoFACode.length < 6 || submitting2FA} className="sl-btn-primary !bg-amber-600 hover:!bg-amber-500">
              {submitting2FA ? 'Verifying...' : 'Submit'}
            </button>
          </div>
        </div>
      )}

      {job.error && job.status !== 'waiting_2fa' && (
        <JobErrorDisplay error={job.error} />
      )}

      <div className="mt-4 border border-[var(--sl-border)] bg-[var(--sl-bg)] rounded-xl overflow-hidden">
        <button
          onClick={() => setShowLogs((prev) => !prev)}
          className="w-full px-3 py-2 text-left text-[12px] text-[var(--sl-muted)] hover:text-[var(--sl-text)] hover:bg-[var(--sl-surface-soft)] transition-colors"
        >
          {showLogs ? '\u25be' : '\u25b8'} Verbose Install Log ({logs.length})
        </button>
        {showLogs && (
          <div className="max-h-56 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed bg-black/40">
            {logs.length === 0 ? (
              <p className="text-[var(--sl-muted)]">Waiting for pipeline output...</p>
            ) : logs.map((line) => (
              <p key={line.id} className={line.level === 'error' ? 'text-red-300' : line.level === 'warn' ? 'text-amber-300' : line.level === 'debug' ? 'text-slate-400' : 'text-[var(--sl-text)]'}>
                [{new Date(line.at).toLocaleTimeString()}]
                {line.step ? ` [${line.step}]` : ''} {line.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobErrorDisplay({ error }: { error: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const formatted = formatJobError(error);

  return (
    <div className="mt-3 sl-card !border-red-500/15 !bg-red-500/[0.04] overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-red-300 text-[13px] font-semibold">{formatted.title}</p>
            <p className="text-red-400/70 text-[12px] mt-1 leading-relaxed">{formatted.description}</p>
            {formatted.action && (
              <p className="text-[var(--sl-muted)] text-[12px] mt-2">
                <span className="text-[var(--sl-muted)] opacity-60">Tip:</span> {formatted.action}
              </p>
            )}
          </div>
        </div>
      </div>
      {error !== formatted.description && (
        <>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="w-full text-left text-[11px] text-[var(--sl-muted)] hover:text-[var(--sl-text)] px-4 py-2 border-t border-red-500/10 hover:bg-red-500/[0.03] transition-colors"
          >
            {showRaw ? '\u25be Hide details' : '\u25b8 Show details'}
          </button>
          {showRaw && (
            <div className="px-4 pb-3 border-t border-red-500/10">
              <pre className="text-[11px] text-[var(--sl-muted)] whitespace-pre-wrap break-all font-mono leading-relaxed max-h-40 overflow-auto mt-2">{error}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === 'completed') return <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  if (status === 'running') return <span className="w-4 h-4 flex items-center justify-center"><span className="w-2.5 h-2.5 bg-[var(--sl-accent)] rounded-full animate-pulse" /></span>;
  if (status === 'waiting_2fa') return <svg className="w-4 h-4 text-amber-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>;
  if (status === 'failed') return <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  return <span className="w-4 h-4 flex items-center justify-center"><span className="w-2.5 h-2.5 border border-[var(--sl-muted)] rounded-full" /></span>;
}
