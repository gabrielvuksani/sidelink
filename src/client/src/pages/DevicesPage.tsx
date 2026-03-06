import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useSSE } from '../hooks/useSSE';
import { useToast } from '../components/Toast';
import { PageLoader, EmptyState } from '../components/Shared';
import type { DeviceInfo } from '../../../shared/types';

export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  useEffect(() => { document.title = 'Devices — Sidelink'; }, []);

  const reload = useCallback(() => {
    api.listDevices().then(r => setDevices(r.data ?? [])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useSSE({ 'device-update': (data) => setDevices(Array.isArray(data) ? data as DeviceInfo[] : []) });

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.refreshDevices();
      setDevices(res.data ?? []);
      toast('success', `Found ${res.data?.length ?? 0} device(s)`);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to refresh devices'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--sl-text)]">Devices</h2>
          <p className="text-[13px] text-[var(--sl-muted)] mt-0.5">Manage connected iOS devices</p>
        </div>
        <button onClick={refresh} disabled={refreshing} className="sl-btn-ghost flex items-center gap-2 disabled:opacity-50">
          {refreshing && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--sl-muted)]/30 border-t-[var(--sl-muted)]" />}
          {refreshing ? 'Scanning...' : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <PageLoader message="Scanning for devices..." />
      ) : devices.length === 0 ? (
        <EmptyState
          title="No devices found"
          description="Connect an iOS device via USB or ensure it's on the same network."
          icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 stagger-children">
          {devices.map(d => (
            <DeviceCard key={d.udid} device={d} onRefresh={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceCard({ device, onRefresh }: { device: DeviceInfo; onRefresh: () => void }) {
  const [pairing, setPairing] = useState(false);
  const { toast } = useToast();

  const pair = async () => {
    setPairing(true);
    try {
      await api.pairDevice(device.udid);
      toast('success', `Paired with ${device.name || 'device'}`);
      onRefresh();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Pairing failed'));
    } finally {
      setPairing(false);
    }
  };

  const isUSB = device.transport === 'usb';

  return (
    <div className="sl-card sl-card-interactive p-4 animate-fadeInUp">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--sl-surface-soft)] shrink-0 mt-0.5">
            <svg className="w-4.5 h-4.5 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[var(--sl-text)]">{device.name || 'iOS Device'}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                isUSB ? 'bg-emerald-500/10 text-emerald-400' : 'bg-cyan-500/10 text-cyan-400'
              }`}>
                {isUSB ? 'USB' : 'WiFi'}
              </span>
              {device.productType && <span className="text-[11px] text-[var(--sl-muted)]">{device.productType}</span>}
              {device.iosVersion && <span className="text-[11px] text-[var(--sl-muted)]">iOS {device.iosVersion}</span>}
            </div>
            <p className="text-[10px] font-mono text-[var(--sl-muted)] opacity-60 mt-1">{device.udid?.slice(0, 16)}...</p>
          </div>
        </div>
        <button onClick={pair} disabled={pairing} className="sl-btn-ghost !text-[12px] !px-3 !py-1.5 flex items-center gap-1.5 disabled:opacity-50">
          {pairing && <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--sl-muted)]/30 border-t-[var(--sl-muted)]" />}
          {pairing ? 'Pairing...' : 'Pair'}
        </button>
      </div>
    </div>
  );
}
