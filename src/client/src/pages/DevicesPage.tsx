import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useSSE } from '../hooks/useSSE';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { PageHeader, PageLoader, EmptyState, SectionHeading, Collapsible } from '../components/Shared';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import type { DeviceInfo } from '../../../shared/types';

// Map common Apple product type codes to friendly device names
function getDeviceModelIcon(productType: string): 'iphone' | 'ipad' | 'unknown' {
  if (!productType) return 'unknown';
  const lower = productType.toLowerCase();
  if (lower.startsWith('iphone')) return 'iphone';
  if (lower.startsWith('ipad')) return 'ipad';
  return 'unknown';
}

function getDeviceDisplayModel(productType: string, model: string): string {
  if (model) return model;
  if (productType) return productType;
  return 'iOS Device';
}

export default function DevicesPage() {
  const warmSnapshot = getUiSnapshot<DeviceInfo[]>('page:devices');
  const [devices, setDevices] = useState<DeviceInfo[]>(warmSnapshot?.data ?? []);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now());
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
      setLastRefreshedAt(Date.now());
    }).catch((e: unknown) => {
      toast('error', getErrorMessage(e, 'Failed to load devices'));
    }).finally(() => setLoading(false));
  }, [toast]);

  usePageRefresh(reload, { initialForce: !warmSnapshot, minIntervalMs: 12_000 });

  useSSE({ 'device-update': (data) => {
    const nextDevices = Array.isArray(data) ? data as DeviceInfo[] : [];
    setDevices(nextDevices);
    setUiSnapshot('page:devices', nextDevices);
    setLastRefreshedAt(Date.now());
  } });

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.refreshDevices();
      const nextDevices = res.data ?? [];
      setDevices(nextDevices);
      setUiSnapshot('page:devices', nextDevices);
      setLastRefreshedAt(Date.now());
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
        title="Connected Devices"
        description="USB and network targets with pairing status and install readiness."
        actions={(
          <button onClick={refresh} disabled={refreshing} className="sl-btn-ghost flex items-center gap-2 disabled:opacity-50" aria-label="Refresh device list">
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
          description="Connect an iOS device to get started."
          icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>}
          action={
            <div className="text-left max-w-md mx-auto mt-2">
              <div className="sl-card p-4 space-y-3">
                <p className="text-[13px] font-semibold text-[var(--sl-text)]">How to connect a device</p>
                <div className="space-y-2.5">
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--sl-accent)]/10 text-[var(--sl-accent)] text-[11px] font-bold">1</span>
                    <p className="text-[12px] text-[var(--sl-muted)]">Connect your iPhone or iPad to this computer via USB cable</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--sl-accent)]/10 text-[var(--sl-accent)] text-[11px] font-bold">2</span>
                    <p className="text-[12px] text-[var(--sl-muted)]">Unlock your device and tap "Trust" when prompted</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--sl-accent)]/10 text-[var(--sl-accent)] text-[11px] font-bold">3</span>
                    <p className="text-[12px] text-[var(--sl-muted)]">Click "Refresh Devices" above or wait for auto-detection</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--sl-accent)]/10 text-[var(--sl-accent)] text-[11px] font-bold">4</span>
                    <p className="text-[12px] text-[var(--sl-muted)]">For WiFi: ensure both devices are on the same network</p>
                  </div>
                </div>
              </div>
            </div>
          }
        />
      ) : (
        <>
          <SectionHeading eyebrow="Inventory" title="Connected targets" description="Transport, model, iOS version, and pairing status." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 stagger-children">
          {devices.map(d => (
            <DeviceCard key={d.udid} device={d} onRefresh={reload} lastRefreshedAt={lastRefreshedAt} />
          ))}
          </div>
        </>
      )}

      {/* Troubleshooting section */}
      <div className="sl-card p-4 mt-2">
        <Collapsible title="Troubleshooting device connections">
          <div className="space-y-3 pt-2 pb-1">
            <TroubleshootTip
              title="Device not showing up"
              detail="Make sure you have the latest iTunes or Apple Devices installed. Try a different USB cable or port. Restart the usbmuxd service if on macOS/Linux."
            />
            <TroubleshootTip
              title="Trust dialog not appearing"
              detail="Disconnect and reconnect the USB cable. Ensure the device is unlocked. Go to Settings > General > Transfer or Reset > Reset Location & Privacy to reset trust settings."
            />
            <TroubleshootTip
              title="WiFi device not detected"
              detail="Both devices must be on the same local network. Enable WiFi sync in Finder/iTunes first via USB, then reconnect."
            />
            <TroubleshootTip
              title="Pairing keeps failing"
              detail="Check that no other tool (Xcode, Apple Configurator, 3uTools) is locking the device connection. Close competing software and retry."
            />
          </div>
        </Collapsible>
      </div>
    </div>
  );
}

function TroubleshootTip({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3">
      <p className="text-[12px] font-semibold text-[var(--sl-text)]">{title}</p>
      <p className="mt-1 text-[11px] text-[var(--sl-muted)] leading-5">{detail}</p>
    </div>
  );
}

function DeviceCard({ device, onRefresh, lastRefreshedAt }: { device: DeviceInfo; onRefresh: () => void; lastRefreshedAt: number }) {
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
  const deviceType = getDeviceModelIcon(device.productType);
  const displayModel = getDeviceDisplayModel(device.productType, device.model);

  // Format "Last seen" time
  const lastSeenText = (() => {
    const seconds = Math.floor((Date.now() - lastRefreshedAt) / 1000);
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  })();

  return (
    <div
      className="sl-card sl-card-interactive p-4 animate-fadeInUp"
      aria-label={`${device.name || 'iOS Device'}, ${isUSB ? 'USB' : 'WiFi'} connection, ${isPaired ? 'paired' : 'not paired'}, ${isOnline ? 'online' : 'offline'}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--sl-surface-soft)] shrink-0 mt-0.5">
            {deviceType === 'ipad' ? (
              <svg className="w-5 h-5 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5h3m-6.75 2.25h10.5a2.25 2.25 0 002.25-2.25v-15a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 4.5v15a2.25 2.25 0 002.25 2.25z" /></svg>
            ) : (
              <svg className="w-5 h-5 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>
            )}
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
              {!isPaired && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
                  Not paired
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                isUSB ? 'bg-emerald-500/10 text-emerald-400' : 'bg-cyan-500/10 text-cyan-400'
              }`}>
                {isUSB ? (
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-3-3m3 3l3-3M5.25 21h13.5" /></svg>
                ) : (
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" /></svg>
                )}
                {isUSB ? 'USB' : 'WiFi'}
              </span>
              {displayModel && <span className="text-[11px] text-[var(--sl-muted)]">{displayModel}</span>}
              {device.iosVersion && <span className="text-[11px] text-[var(--sl-muted)]">iOS {device.iosVersion}</span>}
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <p className="text-[10px] font-mono text-[var(--sl-muted)] opacity-60">{device.udid?.slice(0, 16)}...</p>
              <span className="text-[10px] text-[var(--sl-muted)] opacity-60">Last seen: {lastSeenText}</span>
            </div>
          </div>
        </div>
        <button
          onClick={pair}
          disabled={pairing}
          className="sl-btn-ghost !text-[12px] !px-3 !py-1.5 flex items-center gap-1.5 disabled:opacity-50"
          aria-label={`Pair with ${device.name || 'device'}`}
        >
          {pairing && <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--sl-muted)]/30 border-t-[var(--sl-muted)]" />}
          {pairing ? 'Pairing...' : 'Pair'}
        </button>
      </div>
    </div>
  );
}
