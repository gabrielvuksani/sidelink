// ─── Profile Manager ─────────────────────────────────────────────────
// Manages provisioning profile lifecycle: caching, creation, invalidation.

import { v4 as uuid } from 'uuid';
import type {
  AppIdRecord,
  CertificateRecord,
  ProvisioningProfileRecord,
  DeviceRegistration,
} from '../../shared/types';
import type { AppleDeveloperServicesClient } from '../apple';
import type { Database } from '../state/database';

export class ProfileManager {
  constructor(private db: Database) {}

  async ensureProfile(
    client: AppleDeveloperServicesClient,
    accountId: string,
    teamId: string,
    appId: AppIdRecord,
    _certificate: CertificateRecord,
    deviceReg: DeviceRegistration,
  ): Promise<ProvisioningProfileRecord> {
    // Check for existing valid profile.
    // Invalidate if the device was registered AFTER the profile was created,
    // since the profile may not include the new device.
    const existing = this.db.getActiveProfile(accountId, appId.id);
    if (
      existing
      && new Date(existing.expiresAt) > new Date()
      && new Date(deviceReg.registeredAt) <= new Date(existing.createdAt)
    ) {
      return existing;
    }

    // Download/create profile from Apple
    const portalProfile = await client.downloadProvisioningProfile(
      teamId,
      appId.portalAppIdId,
    );

    const profileData = portalProfile.encodedProfile;

    const expiresAt = portalProfile.expirationDate
      || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const profile: ProvisioningProfileRecord = {
      id: uuid(),
      accountId,
      teamId,
      portalProfileId: portalProfile.provisioningProfileId,
      appIdId: appId.id,
      bundleId: appId.bundleId,
      profileData,
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    this.db.saveProfile(profile);
    return profile;
  }
}
