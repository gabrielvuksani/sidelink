import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useSSE } from '../hooks/useSSE';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { PageHeader, PageLoader, EmptyState, SectionHeading } from '../components/Shared';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import type { DeviceInfo } from '../../../shared/types';

export default function DevicesPage() {
  const warmSnapshot = getUiSnapshot<DeviceInfo[]>('page:devices');
  const [devices, setDevices] = useState<DeviceInfo[]>(warmSnapshot?.data ?? []);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();
  const devicesRef = useRef<DeviceInfo[]>(warmSnapshot?.data ?? []);

  useEffect(() => { document.title = 'Devices — SideLink'; }, []);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  const reload = useCallback((force = false) => {
    if (!devicesRef.current.length) {
      setLoading(true);
    }
    api.listDevices({ bypassCache: force }).then((r) => {
      const nextDevices = r.data ?? [];
      setDevices(nextDevices);
      setUiSnapshot('page:devices', nextDevices);
    }).finally(() => setLoading(false));
  }, []);

  usePageRefresh(reload, { initialForce: !warmSnapshot, minIntervalMs: 12_000 });

  useSSE({ 'device-update': (data) => {
    const nextDevices = Array.isArray(data) ? data as DeviceInfo[] : [];
    setDevices(nextDevices);
    setUiSnapshot('page:devices', nextDevices);
  } });

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.refreshDevices();
      const nextDevices = res.data ?? [];
      setDevices(nextDevices);
      setUiSnapshot('page:devices', nextDevices);
      toast('success', `Found ${nextDevices.length} device(s)`);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to refresh devices'));
    } finally {
      setRefreshing(false);
    }
  };

  const usbDevices = devices.filter((device) => device.transport === 'usb').length;

  return (
    <div className="sl-page animate-fadeIn">
      <PageHeader
        eyebrow="Device Bay"
        title="See which devices are actually ready to receive installs"
        description="USB and network targets are surfaced as an inventory board, with pairing actions kept directly on each card so the install path stays short."
        actions={(
          <button onClick={refresh} disabled={refreshing} className="sl-btn-ghost flex items-center gap-2 disabled:opacity-50">
            {refreshing && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--sl-muted)]/30 border-t-[var(--sl-muted)]" />}
            {refreshing ? 'Scanning...' : 'Refresh Devices'}
          </button>
        )}
        stats={[
          { label: 'Detected', value: devices.length, tone: 'teal' },
          { label: 'USB', value: usbDevices, tone: 'lime' },
          { label: 'Network', value: devices.length - usbDevices, tone: 'sky' },
        ]}
      />

      {loading && devices.length === 0 ? (
        <PageLoader message="Scanning for devices..." />
      ) : devices.length === 0 ? (
        <EmptyState
          title="No devices found"
          description="Connect an iOS device via USB or ensure it's on the same network."
          icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>}
        />
      ) : (
        <>
          <SectionHeading eyebrow="Inventory" title="Connected targets" description="Each card keeps the install-critical details visible: transport, model, iOS version, and pairing action." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 stagger-children">
          {devices.map(d => (
            <DeviceCard key={d.udid} device={d} onRefresh={reload} />
          ))}
          </div>
        </>
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
  const isOnline = device.connection === 'online';
  const isPaired = device.paired;

  return (
    <div className="sl-card sl-card-interactive p-4 animate-fadeInUp">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sl-surface-soft)] shrink-0 mt-0.5">
            <svg className="w-5 h-5 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>
            <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--sl-bg-soft)] ${isOnline ? 'bg-emerald-400' : 'bg-[var(--sl-muted)]/40'}`} title={isOnline ? 'Online' : 'Offline'} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-[var(--sl-text)]">{device.name || 'iOS Device'}</p>
              {isPaired && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.556a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.343 8.06" /></svg>
                  Paired
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                isUSB ? 'bg-emerald-500/10 text-emerald-400' : 'bg-cyan-500/10 text-cyan-400'
              }`}>
                {isUSB ? 'USB' : 'WiFi'}
              </span>
              {device.productType && <span className="text-[11px] text-[var(--sl-muted)]">{device.productType}</span>}
              {device.iosVersion && <span className="text-[11px] text-[var(--sl-muted)]">iOS {device.iosVersion}</span>}
              {device.model && <span className="text-[11px] text-[var(--sl-muted)]">{device.model}</span>}
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
