// ─── App ID Manager ──────────────────────────────────────────────────
// Manages App ID lifecycle: creation, bundle ID generation, cleanup.

import { v4 as uuid } from 'uuid';
import crypto from 'node:crypto';
import type { AppIdRecord } from '../../shared/types';
import { LOG_CODES } from '../../shared/constants';
import type { AppleDeveloperServicesClient } from '../apple';
import type { Database } from '../state/database';
import type { LogService } from './log-service';
import { ProvisioningError, AppIdLimitError, WeeklyAppIdLimitError } from '../utils/errors';

export class AppIdManager {
  constructor(
    private db: Database,
    private logs: LogService,
  ) {}

  async ensureAppId(
    client: AppleDeveloperServicesClient,
    accountId: string,
    teamId: string,
    originalBundleId: string,
    appName: string,
    maxActiveIds: number,
    maxNewAppIdsPerWeek?: number,
    explicitBundleId?: string,
  ): Promise<AppIdRecord> {
    // Check if we already have an App ID for this original bundle
    const existing = this.db.getAppIdByOriginalBundleId(accountId, teamId, originalBundleId);
    if (existing) return existing;

    // Check how many active App IDs we have
    const currentAppIds = this.db.listAppIds(accountId, teamId);
    if (currentAppIds.length >= maxActiveIds) {
      throw new AppIdLimitError(maxActiveIds);
    }

    // Free accounts are limited to creating 10 new App IDs in any rolling 7-day window.
    if (Number.isFinite(maxNewAppIdsPerWeek ?? Infinity)) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const createdRecently = this.db.countAppIdsCreatedSince(accountId, teamId, sevenDaysAgo);
      if (createdRecently >= (maxNewAppIdsPerWeek as number)) {
        throw new WeeklyAppIdLimitError(maxNewAppIdsPerWeek as number);
      }
    }

    // Use explicit bundle ID if provided, otherwise generate one
    const sidelinkBundleId = explicitBundleId ?? this.generateBundleId(originalBundleId, teamId);

    // Create App ID on Apple portal — if it already exists from a prior
    // failed run, look it up via listAppIds and adopt it.
    // Apple requires names to contain only alphanumeric characters and spaces.
    const sanitizedName = `SL ${appName}`.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
    let portalAppId: { appIdId: string; identifier: string; name: string };
    try {
      portalAppId = await client.createAppId(
        teamId,
        sidelinkBundleId,
        sanitizedName,
      );
    } catch (err: any) {
      const isAlreadyExists =
        err?.message?.includes('9400') ||
        err?.message?.includes('is not available');

      if (!isAlreadyExists) throw err;

      this.logs.warn(
        LOG_CODES.APP_ID_CREATED,
        `App ID ${sidelinkBundleId} already exists on portal — adopting`,
      );

      const portalIds = await client.listAppIds(teamId);
      const match = portalIds.find(a => a.identifier === sidelinkBundleId);
      if (!match) {
        throw new ProvisioningError(
          'APP_ID_CONFLICT',
          `Apple says App ID '${sidelinkBundleId}' exists but it was not found in listAppIds. `
          + 'It may belong to another team or be in an invalid state.',
        );
      }
      portalAppId = match;
    }

    const appId: AppIdRecord = {
      id: uuid(),
      accountId,
      teamId,
      portalAppIdId: portalAppId.appIdId,
      bundleId: sidelinkBundleId,
      name: appName,
      originalBundleId,
      createdAt: new Date().toISOString(),
    };

    this.db.saveAppId(appId);
    return appId;
  }

  /**
   * Generate a Sidelink-namespaced bundle ID from the original.
   * Format: com.sidelink.<leaf>.<hash>
   */
  generateBundleId(originalBundleId: string, teamId: string): string {
    const hash = crypto
      .createHash('sha1')
      .update(`${teamId}:${originalBundleId}`)
      .digest('hex')
      .slice(0, 8);

    const parts = originalBundleId.split('.');
    const leaf = parts[parts.length - 1]?.replace(/[^a-zA-Z0-9]/g, '') || 'app';

    return `com.sidelink.${leaf}.${hash}`;
  }

  /**
   * Remove an App ID (frees up a slot for free accounts).
   */
  async removeAppId(
    client: AppleDeveloperServicesClient,
    appIdId: string,
  ): Promise<void> {
    const appId = this.db.prepare<[string], { id: string; team_id: string; portal_app_id_id: string }>(
      'SELECT id, team_id, portal_app_id_id FROM app_ids WHERE id = ?',
    ).get(appIdId);
    if (!appId) return;

    try {
      await client.deleteAppId(appId.team_id, appId.portal_app_id_id);
    } catch {
      // Portal deletion may fail; clean up locally anyway
    }

    this.db.deleteAppId(appIdId);
  }
}
