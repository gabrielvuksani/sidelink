// ─── Device Service ──────────────────────────────────────────────────
// Wraps the pymobiledevice3 adapter with caching, polling, and
// event emission for the rest of the application.

import * as pmd3 from '../adapters/device-adapter';
import type { DeviceInfo } from '../../shared/types';
import type { LogService } from './log-service';
import { LOG_CODES } from '../../shared/constants';

export class DeviceService {
  private devices: Map<string, DeviceInfo> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;
  private listeners: Array<(devices: DeviceInfo[]) => void> = [];

  constructor(private logs: LogService) {}

  /**
   * Check if pymobiledevice3 is available.
   */
  async checkAvailability(): Promise<boolean> {
    try {
      await pmd3.ensurePmd3Available();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start periodic device polling.
   */
  startPolling(intervalMs: number = 5_000): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.refresh(), intervalMs);
    // Also do an immediate refresh
    this.refresh();
  }

  /**
   * Stop device polling.
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Force a device list refresh.
   */
  async refresh(): Promise<DeviceInfo[]> {
    try {
      const freshDevices = await pmd3.listAllDevices();
      const freshMap = new Map(freshDevices.map(d => [d.udid, d]));

      // Detect connect/disconnect events
      for (const [udid, device] of freshMap) {
        if (!this.devices.has(udid)) {
          this.logs.info(LOG_CODES.DEVICE_CONNECTED, `Device connected: ${device.name}`, {
            udid, transport: device.transport,
          });
        }
      }
      for (const [udid, device] of this.devices) {
        if (!freshMap.has(udid)) {
          this.logs.info(LOG_CODES.DEVICE_DISCONNECTED, `Device disconnected: ${device.name}`, {
            udid,
          });
        }
      }

      this.devices = freshMap;
      this.notifyListeners(freshDevices);
      return freshDevices;
    } catch (error) {
      this.logs.warn(LOG_CODES.DEVICE_DISCONNECTED, `Device refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      return this.list();
    }
  }

  /**
   * Get all currently known devices.
   */
  list(): DeviceInfo[] {
    return Array.from(this.devices.values());
  }

  /**
   * Get a specific device by UDID.
   */
  get(udid: string): DeviceInfo | undefined {
    return this.devices.get(udid);
  }

  /**
   * Pair with a device.
   */
  async pair(udid: string): Promise<void> {
    await pmd3.pairDevice(udid);
    this.logs.info(LOG_CODES.DEVICE_PAIRED, `Device paired: ${udid}`, { udid });
    await this.refresh();
  }

  /**
   * Install an IPA on a device.
   */
  async installApp(udid: string, ipaPath: string): Promise<void> {
    const device = this.get(udid);
    const wifiEndpoint = device?.transport === 'wifi'
      ? parseWifiEndpoint(device.wifiAddress)
      : null;

    if (wifiEndpoint) {
      await pmd3.installAppWifi(wifiEndpoint.host, wifiEndpoint.port, ipaPath);
      return;
    }

    await pmd3.installApp(udid, ipaPath);
  }

  /**
   * Subscribe to device list changes.
   */
  onChange(listener: (devices: DeviceInfo[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(devices: DeviceInfo[]): void {
    for (const listener of this.listeners) {
      try { listener(devices); } catch (err) {
        console.warn('[device-service] Listener error:', err);
      }
    }
  }
}

function parseWifiEndpoint(wifiAddress: string | null): { host: string; port: number } | null {
  if (!wifiAddress) return null;

  // Supports common host:port forms (including IPv6 without brackets by
  // splitting on the final colon).
  const match = wifiAddress.match(/^(.*):(\d{1,5})$/);
  if (!match) return null;

  const host = match[1].trim();
  const port = Number.parseInt(match[2], 10);
  if (!host || Number.isNaN(port) || port < 1 || port > 65535) return null;

  return { host, port };
}
