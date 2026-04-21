import { Card } from '../../components/Shared';
import { HelperPairingPanel } from '../../components/HelperPairingPanel';
import { STORAGE_KEYS } from '../../../../shared/constants';

export function DoneStep({ onFinish }: { onFinish: () => void }) {
  const handleFinish = () => {
    localStorage.removeItem(STORAGE_KEYS.wizardStep);
    onFinish();
  };
  return (
    <div>
      <div className="sl-card sl-card-indigo p-8 text-center mb-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-[var(--sl-accent)]/20 flex items-center justify-center mb-4">
          <svg aria-hidden="true" className="w-8 h-8 text-[var(--sl-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-[var(--sl-text)] text-lg font-semibold mb-2">Setup Complete</p>
        <p className="text-[var(--sl-muted)] text-sm">
          The desktop shell is now through first run. If Apple auth or devices still feel broken after this, the next stop should be diagnostics, not another onboarding loop.
        </p>
      </div>

      <div className="mb-6">
        <HelperPairingPanel
          title="Finish mobile setup"
          subtitle="Pair the iPhone helper now so you can browse sources, trigger installs, and refresh apps directly from your phone."
          compact
        />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Card className="p-3 text-center">
          <p className="text-xs text-[var(--sl-muted)]">What's Next</p>
          <p className="text-sm text-[var(--sl-text)] mt-0.5">Go to Install page</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xs text-[var(--sl-muted)]">Need help?</p>
          <p className="text-sm text-[var(--sl-text)] mt-0.5">Check Settings</p>
        </Card>
      </div>

      <button
        onClick={handleFinish}
        className="w-full sl-btn-primary py-3"
      >
        Open Dashboard &rarr;
      </button>
    </div>
  );
}
