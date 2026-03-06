// ─── Provisioning Service ────────────────────────────────────────────
// Orchestrates the full provisioning flow by delegating to focused modules:
//   DeviceRegistrar  — device UDID registration
//   AppIdManager     — App ID creation & bundle ID generation
//   CertificateManager — development certificate lifecycle
//   ProfileManager   — provisioning profile caching & creation
//
// This file is the single entry point consumed by the pipeline.

import type {
  AppleAccount,
  AppIdRecord,
  CertificateRecord,
  ProvisioningProfileRecord,
  DeviceRegistration,
} from '../../shared/types';
import { FREE_ACCOUNT_LIMITS, PAID_ACCOUNT_LIMITS } from '../../shared/constants';
import {
  AppleDeveloperServicesClient,
  CertificateManager,
} from '../apple';
import type { Database } from '../state/database';
import type { LogService } from './log-service';
import { ProvisioningError } from '../utils/errors';
import { DeviceRegistrar } from './device-registrar';
import { AppIdManager } from './app-id-manager';
import { ProfileManager } from './profile-manager';

// ─── Types ──────────────────────────────────────────────────────────

export interface ExtensionProvisioningEntry {
  originalBundleId: string;
  effectiveBundleId: string;
  appId: AppIdRecord;
  profile: ProvisioningProfileRecord;
}

export interface ProvisioningResult {
  certificate: CertificateRecord;
  profile: ProvisioningProfileRecord;
  appId: AppIdRecord;
  deviceRegistration: DeviceRegistration;
  effectiveBundleId: string;
  teamId: string;
  extensionProfiles: ExtensionProvisioningEntry[];
}

// ─── Service ────────────────────────────────────────────────────────

export class ProvisioningService {
  private deviceRegistrar: DeviceRegistrar;
  private appIdManager: AppIdManager;
  private profileManager: ProfileManager;

  constructor(
    private db: Database,
    private logs: LogService,
  ) {
    this.deviceRegistrar = new DeviceRegistrar(db);
    this.appIdManager = new AppIdManager(db, logs);
    this.profileManager = new ProfileManager(db);
  }

  /**
   * Full provisioning flow for installing an app.
   * Accepts a pre-authenticated developer services client.
   */
  async provision(
    client: AppleDeveloperServicesClient,
    account: AppleAccount,
    deviceUdid: string,
    deviceName: string,
    originalBundleId: string,
    appName: string,
    extensionOriginalBundleIds?: string[],
  ): Promise<ProvisioningResult> {
    const teamId = account.teamId;
    if (!teamId) {
      throw new ProvisioningError(
        'NO_TEAM_ID',
        'Apple account has no team ID. Complete authentication first.',
      );
    }

    // ── Step 1: Register device ───────────────────────────────────

    const deviceReg = await this.deviceRegistrar.ensureRegistered(
      client, account.id, teamId, deviceUdid, deviceName,
    );

    const limits = account.accountType === 'paid' ? PAID_ACCOUNT_LIMITS : FREE_ACCOUNT_LIMITS;

    // ── Step 2: Get or create App ID ──────────────────────────────

    const appId = await this.appIdManager.ensureAppId(
      client,
      account.id,
      teamId,
      originalBundleId,
      appName,
      limits.maxActiveAppIds,
      Number.isFinite(limits.maxNewAppIdsPerWeek) ? limits.maxNewAppIdsPerWeek : undefined,
    );

    // ── Step 3: Get or create certificate ─────────────────────────

    const certManager = new CertificateManager(this.db, client);
    const certificate = await certManager.ensureCertificate(account.id, teamId);

    // ── Step 4: Get or create provisioning profile ────────────────

    const profile = await this.profileManager.ensureProfile(
      client, account.id, teamId, appId, certificate, deviceReg,
    );

    // ── Step 5: Provision extensions ──────────────────────────────

    const extensionProfiles: ExtensionProvisioningEntry[] = [];
    if (extensionOriginalBundleIds?.length) {
      const effectiveMainBundleId = appId.bundleId;
      for (const extOrigBid of extensionOriginalBundleIds) {
        // Compute rewritten extension bundle ID (matches rewriteBundleIdentifiers logic)
        const effectiveExtBundleId = extOrigBid.startsWith(originalBundleId + '.')
          ? effectiveMainBundleId + extOrigBid.slice(originalBundleId.length)
          : effectiveMainBundleId + '.' + (extOrigBid.split('.').pop() || 'ext');

        // Build a readable extension name from the last segment of the bundle ID
        const extLeaf = extOrigBid.split('.').pop() || 'ext';
        const extAppName = `${appName} ${extLeaf}`;

        const extAppId = await this.appIdManager.ensureAppId(
          client,
          account.id,
          teamId,
          extOrigBid,
          extAppName,
          limits.maxActiveAppIds,
          Number.isFinite(limits.maxNewAppIdsPerWeek) ? limits.maxNewAppIdsPerWeek : undefined,
          effectiveExtBundleId,
        );

        const extProfile = await this.profileManager.ensureProfile(
          client, account.id, teamId, extAppId, certificate, deviceReg,
        );

        extensionProfiles.push({
          originalBundleId: extOrigBid,
          effectiveBundleId: effectiveExtBundleId,
          appId: extAppId,
          profile: extProfile,
        });
      }
    }

    return {
      certificate,
      profile,
      appId,
      deviceRegistration: deviceReg,
      effectiveBundleId: appId.bundleId,
      teamId,
      extensionProfiles,
    };
  }

  /**
   * Remove an App ID (frees up a slot for free accounts).
   */
  async removeAppId(
    client: AppleDeveloperServicesClient,
    appIdId: string,
  ): Promise<void> {
    return this.appIdManager.removeAppId(client, appIdId);
  }

  /**
   * Get account limits info.
   */
  getAccountLimits(accountType: 'free' | 'paid' | 'unknown') {
    return accountType === 'paid' ? PAID_ACCOUNT_LIMITS : FREE_ACCOUNT_LIMITS;
  }
}
