import { Card } from '../../components/Shared';
import { InlineNotice, StepActions } from './shared';

const features = [
  { title: 'Signing roster', desc: 'Apple sessions, team state, and 2FA pressure stay visible instead of buried in a modal.' },
  { title: 'Device bay', desc: 'USB and network devices surface as transport state you can inspect and refresh on demand.' },
  { title: 'Helper loop', desc: 'The iPhone helper belongs to the release surface, not to a forgotten build step.' },
  { title: 'Release discipline', desc: 'Desktop packaging, helper export, and onboarding should expose problems early instead of shipping ambiguity.' },
];

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {features.map(f => (
          <Card key={f.title} className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-accent)]">Signal</p>
            <p className="mt-3 text-[15px] font-semibold text-[var(--sl-text)]">{f.title}</p>
            <p className="mt-2 text-[13px] leading-6 text-[var(--sl-muted)]">{f.desc}</p>
          </Card>
        ))}
      </div>

      <InlineNotice title="What this setup should prove">
        By the time you finish, you should know whether this machine can authenticate Apple sessions, discover devices, and carry a real install workflow. If it cannot, the issue is environmental and worth fixing immediately.
      </InlineNotice>

      <StepActions onNext={onNext} nextLabel="Get Started" />
    </div>
  );
}
