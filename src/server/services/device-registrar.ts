// ─── Device Registrar ────────────────────────────────────────────────
// Handles device registration with Apple Developer portal and local cache.

import { v4 as uuid } from 'uuid';
import type { DeviceRegistration } from '../../shared/types';
import type { AppleDeveloperServicesClient } from '../apple';
import type { Database } from '../state/database';

export class DeviceRegistrar {
  constructor(private db: Database) {}

  async ensureRegistered(
    client: AppleDeveloperServicesClient,
    accountId: string,
    teamId: string,
    udid: string,
    deviceName: string,
  ): Promise<DeviceRegistration> {
    // Check local cache
    const existing = this.db.getDeviceRegistration(accountId, udid);
    if (existing) return existing;

    // Check Apple portal
    const devices = await client.listDevices(teamId);
    const portalDevice = devices.find(d => d.deviceNumber === udid);

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
      this.db.saveDeviceRegistration(reg);
      return reg;
    }

    // Register new device
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
    return reg;
  }
}
