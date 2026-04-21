// ─── Device Registrar ────────────────────────────────────────────────
// Handles device registration with Apple Developer portal and local cache.
// Serialises concurrent (accountId, udid) registrations to prevent two pipelines
// from racing the Apple portal listDevices / registerDevice calls.

import { v4 as uuid } from 'uuid';
import type { DeviceRegistration } from '../../shared/types';
import type { AppleDeveloperServicesClient } from '../apple';
import type { Database } from '../state/database';

export class DeviceRegistrar {
  private readonly inflight = new Map<string, Promise<DeviceRegistration>>();

  constructor(private db: Database) {}

  async ensureRegistered(
    client: AppleDeveloperServicesClient,
    accountId: string,
    teamId: string,
    udid: string,
    deviceName: string,
  ): Promise<DeviceRegistration> {
    const key = `${accountId}::${udid}`;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const task = (async (): Promise<DeviceRegistration> => {
      const existing = this.db.getDeviceRegistration(accountId, udid);
      if (existing) return existing;

      // Portal listDevices — second concurrent call can race here.
      const devices = await client.listDevices(teamId);
      const portalDevice = devices.find((d) => d.deviceNumber === udid);

      if (portalDevice) {
        const reg: DeviceRegistration = {
          id: uuid(),
          accountId,
          teamId,
          udid,
          portalDeviceId: portalDevice.deviceId,
          deviceName: portalDevice.name,
          registeredAt: new Date().toISOString(),
        };
        // upsert guarantees idempotency against a racing peer write.
        this.db.saveDeviceRegistration(reg);
        return this.db.getDeviceRegistration(accountId, udid) ?? reg;
      }

      const newDevice = await client.registerDevice(teamId, udid, deviceName);
      const reg: DeviceRegistration = {
        id: uuid(),
        accountId,
        teamId,
        udid,
        portalDeviceId: newDevice.deviceId,
        deviceName: newDevice.name,
        registeredAt: new Date().toISOString(),
      };
      this.db.saveDeviceRegistration(reg);
      return this.db.getDeviceRegistration(accountId, udid) ?? reg;
    })();

    this.inflight.set(key, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(key);
    }
  }
}
