// ─── Helper Build Service ────────────────────────────────────────────
// Xcode build logic for the iOS helper IPA: team ID resolution,
// build/export orchestration, and doctor diagnostics.

import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import type { AppContext } from '../context';
import { commandExists, runCommandStrict } from '../utils/command';
import { getHelperIpaPath } from '../utils/paths';
import { diagnoseAppleRuntime } from '../apple/runtime-diagnostics';
import { getHelperPairingState } from './helper-pairing-service';

// ─── Types ───────────────────────────────────────────────────────────

export type TeamResolutionSource =
  | 'request'
  | 'env'
  | 'apple-account-authenticated'
  | 'apple-account-any'
  | 'xcode-signing-identity'
  | 'none';

export type TeamResolution = {
  teamId: string | null;
  source: TeamResolutionSource;
};

// ─── Constants ───────────────────────────────────────────────────────

export const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;

// ─── Team ID Utilities ───────────────────────────────────────────────

export function normalizeTeamId(value: string | undefined | null): string | null {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase();
  return TEAM_ID_PATTERN.test(cleaned) ? cleaned : null;
}

export function dedupeTeamIds(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function sortTeamIdsByFrequency(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([teamId]) => teamId);
}

export function isTeamResolutionBuildError(message: string): boolean {
  return /(No Account for Team|No profiles for|requires a development team|provisioning profile)/i.test(message);
}

// ─── Team ID Resolution ──────────────────────────────────────────────

export async function resolveHelperTeamId(ctx: AppContext, requestedTeamId?: string): Promise<TeamResolution> {
  const fromRequest = normalizeTeamId(requestedTeamId);
  if (fromRequest) {
    return { teamId: fromRequest, source: 'request' };
  }

  const fromEnv = normalizeTeamId(process.env.SIDELINK_TEAM_ID);
  if (fromEnv) {
    return { teamId: fromEnv, source: 'env' };
  }

  const accounts = ctx.appleAccounts.list();
  const fromAuthenticatedAccount = accounts
    .filter((account) => account.status === 'active')
    .map((account) => normalizeTeamId(account.teamId))
    .find((teamId): teamId is string => !!teamId);
  if (fromAuthenticatedAccount) {
    return { teamId: fromAuthenticatedAccount, source: 'apple-account-authenticated' };
  }

  const fromAnyAccount = accounts
    .map((account) => normalizeTeamId(account.teamId))
    .find((teamId): teamId is string => !!teamId);
  if (fromAnyAccount) {
    return { teamId: fromAnyAccount, source: 'apple-account-any' };
  }

  const fromSigningIdentity = await detectTeamIdFromSigningIdentity();
  if (fromSigningIdentity) {
    return { teamId: fromSigningIdentity, source: 'xcode-signing-identity' };
  }

  return { teamId: null, source: 'none' };
}

export async function detectTeamIdFromSigningIdentity(): Promise<string | null> {
  const teamIds = await detectTeamIdsFromSigningIdentity();
  return teamIds[0] ?? null;
}

export async function detectTeamIdsFromSigningIdentity(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  if (!(await commandExists('security'))) return [];

  try {
    const result = await runCommandStrict('security', {
      args: ['find-identity', '-v', '-p', 'codesigning'],
      timeoutMs: 20_000,
    });
    const lines = `${result.stdout}\n${result.stderr}`.split('\n');
    const foundWithDuplicates: string[] = [];
    for (const line of lines) {
      // Example: "1) <hash> \"Apple Development: Name (AB12CD34EF)\""
      const match = line.match(/Apple Development:[^\(]*\(([A-Z0-9]{10})\)/i);
      if (match?.[1]) {
        const normalized = normalizeTeamId(match[1]);
        if (normalized) foundWithDuplicates.push(normalized);
      }
    }
    return sortTeamIdsByFrequency(foundWithDuplicates);
  } catch {
    return [];
  }
}

export async function listFallbackTeamIds(ctx: AppContext, preferredTeamId: string | null): Promise<string[]> {
  const allCandidates = dedupeTeamIds([
    ...ctx.appleAccounts.list()
      .filter((account) => account.status === 'active')
      .map((account) => normalizeTeamId(account.teamId)),
    ...ctx.appleAccounts.list().map((account) => normalizeTeamId(account.teamId)),
    ...(await detectTeamIdsFromSigningIdentity()).map((value) => normalizeTeamId(value)),
  ]);
  const preferred = normalizeTeamId(preferredTeamId);
  return allCandidates.filter((candidate) => candidate !== preferred);
}

// ─── Environment ─────────────────────────────────────────────────────

export function buildCommandEnv(overrides?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') base[key] = value;
  }
  if (overrides) {
    Object.assign(base, overrides);
  }
  return base;
}

// ─── IPA Build & Import ──────────────────────────────────────────────

export async function buildHelperIpa(teamId?: string, fallbackTeamIds: string[] = []): Promise<string | null> {
  if (process.platform !== 'darwin') {
    throw new Error('Helper IPA build requires macOS with Xcode. Use a prebuilt helper IPA on this platform.');
  }

  if (!(await commandExists('xcodebuild'))) {
    throw new Error('xcodebuild is not available. Install full Xcode and open it once to finish setup.');
  }

  const helperProjectDir = process.env.SIDELINK_HELPER_PROJECT_DIR
    ? path.resolve(process.env.SIDELINK_HELPER_PROJECT_DIR)
    : path.join(process.cwd(), 'ios-helper', 'SidelinkHelper');
  const projectFile = path.join(helperProjectDir, 'SidelinkHelper.xcodeproj');
  const projectYml = path.join(helperProjectDir, 'project.yml');
  const scheme = process.env.SIDELINK_HELPER_SCHEME ?? 'SidelinkHelper';

  const canUseXcodegen = fs.existsSync(projectYml) && (await commandExists('xcodegen'));
  if (canUseXcodegen) {
    await runCommandStrict('xcodegen', {
      args: ['generate'],
      cwd: helperProjectDir,
      timeoutMs: 60_000,
    });
  }

  if (!fs.existsSync(projectFile)) {
    throw new Error('Missing iOS helper project. Ensure ios-helper/SidelinkHelper exists and includes SidelinkHelper.xcodeproj or project.yml.');
  }

  const archivePath = path.join(process.cwd(), 'tmp', 'helper', 'SidelinkHelper.xcarchive');
  const exportDir = path.join(process.cwd(), 'tmp', 'helper', 'export');
  const exportOptionsPlist = process.env.SIDELINK_HELPER_EXPORT_OPTIONS_PLIST
    ? path.resolve(process.env.SIDELINK_HELPER_EXPORT_OPTIONS_PLIST)
    : path.join(helperProjectDir, 'ExportOptions.plist');

  if (!fs.existsSync(exportOptionsPlist)) {
    throw new Error(`Missing ExportOptions.plist at ${exportOptionsPlist}`);
  }

  await fsPromises.mkdir(path.join(process.cwd(), 'tmp', 'helper'), { recursive: true });
  await fsPromises.rm(exportDir, { recursive: true, force: true });
  await fsPromises.mkdir(exportDir, { recursive: true });

  const candidates = dedupeTeamIds([
    normalizeTeamId(teamId),
    ...fallbackTeamIds.map((value) => normalizeTeamId(value)),
  ]);
  const candidateList: Array<string | undefined> = candidates.length > 0
    ? candidates
    : [undefined];

  let lastError: Error | null = null;
  let selectedTeamId: string | null = null;

  for (let i = 0; i < candidateList.length; i += 1) {
    const candidate = candidateList[i];
    const env = buildCommandEnv(candidate ? { SIDELINK_TEAM_ID: String(candidate) } : undefined);

    try {
      await runCommandStrict('xcodebuild', {
        args: [
          '-project', projectFile,
          '-scheme', scheme,
          '-configuration', 'Release',
          '-destination', 'generic/platform=iOS',
          '-archivePath', archivePath,
          '-allowProvisioningUpdates',
          'archive',
        ],
        env,
        timeoutMs: 10 * 60_000,
      });

      await runCommandStrict('xcodebuild', {
        args: [
          '-exportArchive',
          '-archivePath', archivePath,
          '-exportPath', exportDir,
          '-exportOptionsPlist', exportOptionsPlist,
          '-allowProvisioningUpdates',
        ],
        env,
        timeoutMs: 10 * 60_000,
      });

      selectedTeamId = candidate ?? null;
      lastError = null;
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(message);
      const hasNext = i < candidateList.length - 1;
      if (!hasNext || !isTeamResolutionBuildError(message)) {
        throw lastError;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  const helperIpaPath = getHelperIpaPath();
  const exportEntries = await fsPromises.readdir(exportDir);
  const ipaName = exportEntries.find((entry) => entry.toLowerCase().endsWith('.ipa'));
  if (!ipaName) {
    throw new Error('xcodebuild export finished but no IPA was produced.');
  }

  const sourceIpaPath = path.join(exportDir, ipaName);
  await fsPromises.mkdir(path.dirname(helperIpaPath), { recursive: true });
  await fsPromises.copyFile(sourceIpaPath, helperIpaPath);

  return selectedTeamId;
}

export async function importHelperIpaIntoLibrary(ctx: AppContext, helperIpaPath: string) {
  const targetPath = path.join(ctx.uploadDir, `helper-${Date.now()}.ipa`);
  await fsPromises.mkdir(ctx.uploadDir, { recursive: true });
  await fsPromises.copyFile(helperIpaPath, targetPath);
  return ctx.ipas.processUpload(targetPath, 'SidelinkHelper.ipa');
}

// ─── Doctor / Diagnostics ────────────────────────────────────────────

export async function buildHelperDoctorSnapshot(ctx: AppContext) {
  const helperIpaPath = getHelperIpaPath();
  const helperProjectDir = process.env.SIDELINK_HELPER_PROJECT_DIR
    ? path.resolve(process.env.SIDELINK_HELPER_PROJECT_DIR)
    : path.join(process.cwd(), 'ios-helper', 'SidelinkHelper');
  const xcodeProjectPath = path.join(helperProjectDir, 'SidelinkHelper.xcodeproj');
  const projectYmlPath = path.join(helperProjectDir, 'project.yml');

  const hasXcodebuild = process.platform === 'darwin' ? await commandExists('xcodebuild') : false;
  const hasXcodegen = process.platform === 'darwin' ? await commandExists('xcodegen') : false;
  const resolvedTeam = await resolveHelperTeamId(ctx);
  const appleRuntime = await diagnoseAppleRuntime();
  const pairing = getHelperPairingState(ctx);

  return {
    platform: process.platform,
    helperIpaPath,
    helperIpaExists: fs.existsSync(helperIpaPath),
    helperProjectDir,
    xcodeProjectExists: fs.existsSync(xcodeProjectPath),
    projectYmlExists: fs.existsSync(projectYmlPath),
    hasXcodebuild,
    hasXcodegen,
    appleAuthReady: appleRuntime.ready,
    appleAuthError: appleRuntime.error ?? null,
    appleRuntime,
    helperPaired: pairing.paired,
    helperTokenSource: pairing.tokenSource,
    helperPairedAt: pairing.pairedAt,
    pairingCodeExpiresAt: pairing.pairingCodeExpiresAt,
    pairingCodeActive: pairing.pairingCodeActive,
    detectedTeamId: resolvedTeam.teamId,
    detectedTeamIdSource: resolvedTeam.source,
  };
}
