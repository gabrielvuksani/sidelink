// ─── Profile Manager ─────────────────────────────────────────────────
// Manages provisioning profile lifecycle: caching, creation, invalidation.

import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import type {
  AppIdRecord,
  CertificateRecord,
  ProvisioningProfileRecord,
  DeviceRegistration,
} from '../../shared/types';
import type { AppleDeveloperServicesClient } from '../apple';
import type { Database } from '../state/database';
import { parseMobileProvision } from '../utils/plist';

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
      && this.isProfileUsable(existing.profileData, teamId, appId.bundleId, _certificate, deviceReg.udid)
    ) {
      return existing;
    }

    const portalProfile = await this.refreshProfile(
      client,
      teamId,
      appId,
      _certificate,
      deviceReg.udid,
      existing?.portalProfileId,
    );

    return this.persistProfile(accountId, teamId, appId, portalProfile);
  }

  private async refreshProfile(
    client: AppleDeveloperServicesClient,
    teamId: string,
    appId: AppIdRecord,
    certificate: CertificateRecord,
    deviceUdid: string,
    existingPortalProfileId?: string,
  ) {
    if (existingPortalProfileId) {
      await client.deleteProvisioningProfile(teamId, existingPortalProfileId).catch(() => {});
    }

    const firstAttempt = await client.downloadProvisioningProfile(teamId, appId.portalAppIdId);
    if (this.isProfileUsable(firstAttempt.encodedProfile, teamId, appId.bundleId, certificate, deviceUdid)) {
      return firstAttempt;
    }

    if (firstAttempt.provisioningProfileId) {
      await client.deleteProvisioningProfile(teamId, firstAttempt.provisioningProfileId).catch(() => {});
    }

    const secondAttempt = await client.downloadProvisioningProfile(teamId, appId.portalAppIdId);
    if (!this.isProfileUsable(secondAttempt.encodedProfile, teamId, appId.bundleId, certificate, deviceUdid)) {
      throw new Error(`Apple returned a provisioning profile that does not match ${appId.bundleId} or the active signing certificate.`);
    }

    return secondAttempt;
  }

  private persistProfile(
    accountId: string,
    teamId: string,
    appId: AppIdRecord,
    portalProfile: {
      provisioningProfileId: string;
      expirationDate?: string;
      encodedProfile: string;
    },
  ): ProvisioningProfileRecord {

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

  private isProfileUsable(
    profileDataBase64: string,
    teamId: string,
    bundleId: string,
    certificate: CertificateRecord,
    deviceUdid: string,
  ): boolean {
    try {
      const profilePlist = parseMobileProvision(Buffer.from(profileDataBase64, 'base64'));
      const entitlements = (profilePlist['Entitlements'] || {}) as Record<string, unknown>;
      const appIdentifier = String(entitlements['application-identifier'] || '');
      const expectedAppIdentifier = `${teamId}.${bundleId}`;
      if (appIdentifier !== expectedAppIdentifier) {
        return false;
      }

      const provisionedDevices = Array.isArray(profilePlist['ProvisionedDevices'])
        ? profilePlist['ProvisionedDevices'].map((value) => String(value))
        : [];
      if (provisionedDevices.length > 0 && !provisionedDevices.includes(deviceUdid)) {
        return false;
      }

      const developerCertificates = this.extractDeveloperCertificateFingerprints(profilePlist['DeveloperCertificates']);
      if (developerCertificates.length > 0) {
        const activeFingerprint = new crypto.X509Certificate(certificate.certificatePem).fingerprint256;
        if (!developerCertificates.includes(activeFingerprint)) {
          return false;
        }
      }

      const expirationDate = profilePlist['ExpirationDate'];
      if (expirationDate && Number.isFinite(Date.parse(String(expirationDate)))) {
        if (Date.parse(String(expirationDate)) <= Date.now()) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  private extractDeveloperCertificateFingerprints(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const fingerprints: string[] = [];
    for (const entry of value) {
      const bytes = this.normalizeCertificateBytes(entry);
      if (!bytes) {
        continue;
      }

      try {
        fingerprints.push(new crypto.X509Certificate(bytes).fingerprint256);
      } catch {
        continue;
      }
    }

    return fingerprints;
  }

  private normalizeCertificateBytes(value: unknown): Buffer | null {
    if (Buffer.isBuffer(value)) {
      return value;
    }
    if (value instanceof Uint8Array) {
      return Buffer.from(value);
    }
    if (typeof value === 'string' && value.length > 0) {
      try {
        return Buffer.from(value, 'base64');
      } catch {
        return null;
      }
    }
    return null;
  }
}
