import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { AppContext } from '../context';
import { startInstallPipeline } from '../pipeline';
import { FREE_ACCOUNT_LIMITS } from '../../shared/constants';

type SafeAppleAccountInput = {
  id: string;
  appleId: string;
  teamId: string;
  teamName: string;
  accountType: string;
  status: string;
  lastAuthAt?: string | null;
  createdAt: string;
};

export function toSafeAppleAccount(account: SafeAppleAccountInput) {
  return {
    id: account.id,
    appleId: account.appleId,
    teamId: account.teamId,
    teamName: account.teamName,
    accountType: account.accountType,
    status: account.status,
    lastAuthAt: account.lastAuthAt ?? null,
    createdAt: account.createdAt,
  };
}

export function listSafeAppleAccounts(ctx: AppContext) {
  return ctx.appleAccounts.list().map(toSafeAppleAccount);
}

export async function syncAndListAppleAppIds(ctx: AppContext, sync: boolean) {
  const data = await Promise.all(ctx.appleAccounts.list().map(async (account) => {
    if (sync && account.status === 'active') {
      try {
        const client = await ctx.appleAccounts.getDevClient(account.id);
        const remoteAppIds = await client.listAppIds(account.teamId);
        for (const remote of remoteAppIds) {
          const exists = ctx.db.listAppIds(account.id, account.teamId).some((entry) => entry.portalAppIdId === remote.appIdId);
          if (!exists) {
            ctx.db.saveAppId({
              id: crypto.randomUUID(),
              accountId: account.id,
              teamId: account.teamId,
              portalAppIdId: remote.appIdId,
              bundleId: remote.identifier,
              name: remote.name,
              originalBundleId: remote.identifier,
              createdAt: new Date().toISOString(),
            });
          }
        }
      } catch {
        // Best-effort sync only.
      }
    }

    return ctx.db.listAppIds(account.id, account.teamId).map((appId) => ({
      ...appId,
      accountAppleId: account.appleId,
      teamName: account.teamName,
    }));
  }));

  return data.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listAppleAppIdUsage(ctx: AppContext) {
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return ctx.appleAccounts.list().map((account) => ({
    accountId: account.id,
    appleId: account.appleId,
    teamId: account.teamId,
    active: ctx.db.countActiveAppIds(account.id, account.teamId),
    weeklyCreated: ctx.db.countAppIdsCreatedSince(account.id, account.teamId, sevenDaysAgoIso),
    maxActive: FREE_ACCOUNT_LIMITS.maxAppIds,
    maxWeekly: FREE_ACCOUNT_LIMITS.maxNewAppIdsPerWeek,
  }));
}

export async function deleteAppleAppId(ctx: AppContext, id: string) {
  const target = ctx.appleAccounts
    .list()
    .flatMap((account) => ctx.db.listAppIds(account.id, account.teamId))
    .find((entry) => entry.id === id);

  if (!target) {
    return false;
  }

  try {
    const client = await ctx.appleAccounts.getDevClient(target.accountId);
    await client.deleteAppId(target.teamId, target.portalAppIdId);
  } catch {
    // Local cleanup still proceeds.
  }

  ctx.db.deleteAppId(target.id);
  return true;
}

export function listAppleCertificates(ctx: AppContext) {
  return ctx.appleAccounts.list().flatMap((account) =>
    ctx.db.listCertificates(account.id).map((certificate) => ({
      ...certificate,
      accountAppleId: account.appleId,
      teamName: account.teamName,
    })),
  );
}

export function listTrustedSources() {
  const filePath = path.join(process.cwd(), 'src', 'server', 'data', 'trusted-sources.json');
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export async function deactivateInstalledApp(ctx: AppContext, id: string) {
  const app = ctx.db.getInstalledApp(id);
  if (!app) {
    return null;
  }

  await ctx.devices.uninstallApp(app.deviceUdid, app.bundleId);
  ctx.db.updateInstalledAppStatus(app.id, 'deactivated');
  return ctx.db.getInstalledApp(app.id);
}

export async function reactivateInstalledApp(ctx: AppContext, id: string) {
  const app = ctx.db.getInstalledApp(id);
  if (!app) {
    return { kind: 'missing' as const };
  }
  if (!app.ipaId) {
    return { kind: 'missing-ipa' as const };
  }

  const job = await startInstallPipeline(ctx.pipelineDeps, {
    ipaId: app.ipaId,
    accountId: app.accountId,
    deviceUdid: app.deviceUdid,
  });

  ctx.db.updateInstalledAppStatus(app.id, 'active');
  return { kind: 'ok' as const, job };
}

export async function startValidatedInstall(
  ctx: AppContext,
  params: {
    ipaId: string;
    accountId: string;
    deviceUdid: string;
    includeExtensions?: boolean;
  },
) {
  const ipa = ctx.db.getIpa(params.ipaId);
  if (!ipa) {
    return { kind: 'missing-ipa' as const };
  }

  const account = ctx.appleAccounts.get(params.accountId);
  if (!account) {
    return { kind: 'missing-account' as const };
  }
  if (account.status !== 'active') {
    return { kind: 'inactive-account' as const };
  }

  const device = ctx.devices.get(params.deviceUdid);
  if (!device) {
    return { kind: 'missing-device' as const };
  }

  const job = await startInstallPipeline(ctx.pipelineDeps, {
    ipaId: params.ipaId,
    accountId: params.accountId,
    deviceUdid: params.deviceUdid,
    includeExtensions: params.includeExtensions,
  });

  return { kind: 'ok' as const, job, ipa, account, device };
}

export async function triggerRefreshAllActiveApps(ctx: AppContext) {
  const apps = ctx.db.listInstalledAppsByStatus('active');
  const results = await Promise.allSettled(apps.map((app) => ctx.scheduler.triggerRefresh(app.id)));
  const errors = results
    .map((result, index) => ({ result, app: apps[index] }))
    .filter((entry): entry is { result: PromiseRejectedResult; app: typeof apps[number] } => entry.result.status === 'rejected')
    .map((entry) => `${entry.app.appName || entry.app.originalBundleId}: ${String(entry.result.reason)}`);

  return {
    triggered: results.filter((result) => result.status === 'fulfilled').length,
    skipped: errors.length,
    errors,
  };
}

export async function listDeviceAppInventory(ctx: AppContext, udid: string) {
  const device = ctx.devices.get(udid);
  if (!device) {
    return null;
  }

  const managed = ctx.db.listInstalledAppsForDevice(device.udid);
  const installedBundleIds = await ctx.devices.listInstalledApps(device.udid);
  const managedIds = new Set(managed.map((app) => app.bundleId));
  const unmanaged = installedBundleIds
    .filter((bundleId) => !managedIds.has(bundleId))
    .map((bundleId) => ({ bundleId, name: bundleId }));

  return { managed, unmanaged };
}