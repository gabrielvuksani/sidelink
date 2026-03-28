import { useState, useCallback, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { Card } from '../../components/Shared';
import { InlineNotice, StepActions } from './shared';
import type { DeviceInfo } from '../../../../shared/types';

export function DeviceStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const { toast } = useToast();

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await api.refreshDevices();
      setDevices(res.data ?? []);
      if (!initialLoad && (res.data?.length ?? 0) > 0) {
        toast('success', `Found ${res.data?.length} device(s)`);
      }
    } catch {
      // Silently handle — user can retry
    } finally {
      setScanning(false);
      setInitialLoad(false);
    }
  }, [initialLoad, toast]);

  useEffect(() => { scan(); }, []);  // initial scan

  return (
    <div>
      <InlineNotice title="Transport Reality Check" tone="warning">
        If you see no devices here in the packaged macOS app, first verify the machine can talk to iOS hardware at all. Trust prompts, USB transport, and the local device stack need to work before installs will.
      </InlineNotice>

      {devices.length > 0 ? (
        <div className="mt-5 space-y-3 mb-4">
          {devices.map(d => (
            <Card key={d.udid} className="p-3 flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                d.transport === 'usb' ? 'bg-emerald-950/50 text-emerald-400' : 'bg-cyan-950/50 text-cyan-400'
              }`}>
                <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                </svg>
              </div>
              <div>
                <p className="text-[var(--sl-text)] text-sm font-medium">{d.name || 'iOS Device'}</p>
                <p className="text-[var(--sl-muted)] text-xs">
                  {d.productType ?? 'Unknown'} · {d.transport === 'usb' ? 'USB' : 'WiFi'}
                  {d.iosVersion ? ` · iOS ${d.iosVersion}` : ''}
                </p>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="mt-5 sl-card p-8 text-center mb-4">
          {scanning ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[var(--sl-accent)] border-t-transparent rounded-full animate-spin" />
              <p className="text-[var(--sl-muted)] text-sm">Scanning for devices...</p>
            </div>
          ) : (
            <>
              <svg aria-hidden="true" className="w-10 h-10 text-[var(--sl-muted)] mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
              </svg>
              <p className="text-[var(--sl-text)] text-sm mb-1">No devices found</p>
              <p className="text-[var(--sl-muted)] text-xs">Connect an iOS device via USB or WiFi, then scan again.</p>
            </>
          )}
        </div>
      )}

      {!scanning && (
        <button
          onClick={scan}
          className="w-full text-sm sl-btn-ghost mb-2 flex items-center justify-center gap-2"
        >
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          Scan Again
        </button>
      )}

      <StepActions
        onBack={onBack}
        onNext={onNext}
        nextLabel={devices.length > 0 ? 'Continue' : 'Skip for now'}
        showSkip={devices.length > 0}
        onSkip={onNext}
      />
    </div>
  );
}
