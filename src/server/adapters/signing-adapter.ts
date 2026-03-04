import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import plist from 'plist';
import { AppError } from '../utils/errors';
import { readEnv } from '../utils/env';
import { parseMobileProvision, parseMobileProvisionEntitlements, parsePlistBuffer } from '../utils/plist';
import { CommandRunner, ShellCommandRunner } from './command-runner';
import { CommandAuditWriter } from './toolchain-types';

export interface SigningExecutionParams {
  ipaPath: string;
  signingIdentity: string;
  timeoutMs?: number;
}

export interface SigningExecutionResult {
  signedIpaPath: string;
  workingDir: string;
  effectiveBundleId?: string;
  cleanup: () => Promise<void>;
}

export interface SigningAdapter {
  ensureAvailable(): Promise<void>;
  sign(params: SigningExecutionParams, audit?: CommandAuditWriter): Promise<SigningExecutionResult>;
}

interface ProvisionProfileCandidate {
  path: string;
  entitlements: Record<string, unknown>;
  appIdentifier?: string;
  teamIds: string[];
  expiresAt?: Date;
  source: 'env' | 'embedded' | 'library';
}

interface ProvisionResolution {
  profile: ProvisionProfileCandidate;
  effectiveBundleId: string;
  reason: string;
}

const REAL_PROVISION_PROFILE_ENV_KEYS = ['SIDELINK_REAL_PROVISION_PROFILE', 'ALTSTORE_REAL_PROVISION_PROFILE'];
const REAL_BUNDLE_ID_OVERRIDE_ENV_KEYS = ['SIDELINK_REAL_BUNDLE_ID_OVERRIDE', 'ALTSTORE_REAL_BUNDLE_ID_OVERRIDE'];

const complianceError =
  'This demo intentionally blocks enterprise/distribution/jailbreak-style flows. Use a personal Apple Development identity only.';

export class RealSigningAdapter implements SigningAdapter {
  constructor(private readonly runner: CommandRunner = new ShellCommandRunner()) {}

  public async ensureAvailable(): Promise<void> {
    const checks = await Promise.all([
      this.runner.exists('codesign'),
      this.runner.exists('security'),
      this.runner.exists('unzip'),
      this.runner.exists('zip')
    ]);

    if (checks.every(Boolean)) {
      return;
    }

    throw new AppError(
      'REAL_SIGNING_TOOLCHAIN_MISSING',
      'Real signing requires codesign, security, unzip, and zip.',
      400,
      'Install Xcode command line tools (`xcode-select --install`) and ensure zip/unzip are available.'
    );
  }

  public async sign(params: SigningExecutionParams, audit?: CommandAuditWriter): Promise<SigningExecutionResult> {
    await access(params.ipaPath).catch(() => {
      throw new AppError('IPA_FILE_MISSING', `IPA file not found at ${params.ipaPath}.`, 404, 'Upload IPA again and retry.');
    });

    this.assertIdentityCompliance(params.signingIdentity);
    await this.ensureAvailable();

    const timeoutMs = params.timeoutMs ?? 25_000;
    const identityList = await this.runAudited(
      {
        command: 'security',
        args: ['find-identity', '-v', '-p', 'codesigning'],
        timeoutMs
      },
      audit
    );

    if (identityList.code !== 0) {
      throw new AppError(
        'SIGNING_IDENTITY_DISCOVERY_FAILED',
        identityList.stderr || identityList.stdout || 'Unable to list local signing identities.',
        400,
        'Open Keychain Access and ensure an Apple Development identity is installed and trusted.'
      );
    }

    if (!identityList.stdout.toLowerCase().includes(params.signingIdentity.toLowerCase())) {
      throw new AppError(
        'SIGNING_IDENTITY_NOT_FOUND',
        `Signing identity "${params.signingIdentity}" was not found in local keychain.`,
        400,
        'Set SIDELINK_REAL_SIGNING_IDENTITY (or legacy ALTSTORE_REAL_SIGNING_IDENTITY) to an exact Apple Development identity from `security find-identity -v -p codesigning`.'
      );
    }

    const teamId = this.extractTeamId(params.signingIdentity);
    if (!teamId) {
      throw new AppError(
        'SIGNING_IDENTITY_TEAM_ID_MISSING',
        `Could not extract a Team ID from identity "${params.signingIdentity}".`,
        400,
        'Use an identity string that includes your Team ID, for example: Apple Development: Name (TEAMID).'
      );
    }

    const workingDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-real-sign-'));
    const unpackDir = path.join(workingDir, 'unpacked');

    try {
      await mkdir(unpackDir, { recursive: true });

      const unzipResult = await this.runAudited(
        {
          command: 'unzip',
          args: ['-q', '-o', params.ipaPath, '-d', unpackDir],
          timeoutMs
        },
        audit
      );

      if (unzipResult.code !== 0) {
        throw new AppError(
          'IPA_UNZIP_FAILED',
          unzipResult.stderr || unzipResult.stdout || 'Failed to unpack IPA archive.',
          400,
          'Verify IPA integrity, then retry.'
        );
      }

      const payloadDir = path.join(unpackDir, 'Payload');
      const payloadEntries = await readdir(payloadDir, { withFileTypes: true }).catch(() => []);
      const appDir = payloadEntries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));

      if (!appDir) {
        throw new AppError(
          'PAYLOAD_APP_NOT_FOUND',
          'Could not find Payload/<App>.app after unpacking IPA.',
          400,
          'Use a standard exported IPA from Xcode archive/export flow.'
        );
      }

      const appPath = path.join(payloadDir, appDir.name);
      const originalBundleId = await this.readBundleIdentifier(appPath);

      const resolution = await this.resolveProvisioningProfile({
        appPath,
        bundleId: originalBundleId,
        teamId
      });

      if (resolution.effectiveBundleId !== originalBundleId) {
        await this.rewriteBundleIdentifiers(appPath, originalBundleId, resolution.effectiveBundleId);
        await this.recordNote(
          audit,
          `Bundle identifier remapped ${originalBundleId} -> ${resolution.effectiveBundleId} (${resolution.reason}).`
        );
      }

      const embeddedProfilePath = path.join(appPath, 'embedded.mobileprovision');
      await copyFile(resolution.profile.path, embeddedProfilePath);

      await this.recordNote(
        audit,
        `Using provisioning profile (${resolution.profile.source}) ${path.basename(resolution.profile.path)} for ${resolution.effectiveBundleId}.`
      );

      const entitlements = this.buildSigningEntitlements({
        bundleId: resolution.effectiveBundleId,
        teamId,
        profileEntitlements: resolution.profile.entitlements
      });
      const entitlementsPath = path.join(workingDir, 'entitlements.plist');
      await writeFile(entitlementsPath, plist.build(entitlements as any), 'utf8');

      const signResult = await this.runAudited(
        {
          command: 'codesign',
          args: ['-f', '--deep', '--generate-entitlement-der', '-s', params.signingIdentity, '--entitlements', entitlementsPath, appPath],
          timeoutMs: timeoutMs * 2
        },
        audit
      );

      if (signResult.code !== 0) {
        throw new AppError(
          'REAL_SIGNING_FAILED',
          signResult.stderr || signResult.stdout || 'codesign failed.',
          400,
          'Confirm provisioning profile + entitlements match this app and signing identity.'
        );
      }

      const verifyResult = await this.runAudited(
        {
          command: 'codesign',
          args: ['--verify', '--deep', '--strict', appPath],
          timeoutMs
        },
        audit
      );

      if (verifyResult.code !== 0) {
        throw new AppError(
          'REAL_SIGNING_VERIFY_FAILED',
          verifyResult.stderr || verifyResult.stdout || 'codesign verification failed.',
          400,
          'Signing completed but verification failed. Inspect command logs for failing bundle paths.'
        );
      }

      const signedIpaPath = path.join(workingDir, 'signed.ipa');
      const zipResult = await this.runAudited(
        {
          command: 'zip',
          args: ['-qry', signedIpaPath, 'Payload'],
          cwd: unpackDir,
          timeoutMs: timeoutMs * 2
        },
        audit
      );

      if (zipResult.code !== 0) {
        throw new AppError(
          'IPA_REPACK_FAILED',
          zipResult.stderr || zipResult.stdout || 'Failed to re-pack signed IPA.',
          400,
          'Inspect disk permissions and free space, then retry.'
        );
      }

      return {
        signedIpaPath,
        workingDir,
        effectiveBundleId: resolution.effectiveBundleId,
        cleanup: async () => {
          await rm(workingDir, { recursive: true, force: true });
        }
      };
    } catch (error) {
      await rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async readBundleIdentifier(appPath: string): Promise<string> {
    const infoPath = path.join(appPath, 'Info.plist');
    const infoBuffer = await readFile(infoPath).catch(() => {
      throw new AppError(
        'INFO_PLIST_SIGNING_READ_FAILED',
        'Could not read Payload/<App>.app/Info.plist while preparing signing.',
        400,
        'Use a standard IPA package with a valid app bundle structure.'
      );
    });

    let info: Record<string, unknown>;
    try {
      info = parsePlistBuffer(infoBuffer);
    } catch (error) {
      throw new AppError(
        'INFO_PLIST_SIGNING_PARSE_FAILED',
        `Failed to parse Info.plist during signing prep: ${error instanceof Error ? error.message : String(error)}`,
        400,
        'Upload a valid IPA generated by a normal archive/export flow.'
      );
    }

    const bundleId = String(info.CFBundleIdentifier ?? '').trim();
    if (!bundleId) {
      throw new AppError(
        'BUNDLE_ID_MISSING',
        'CFBundleIdentifier is missing from Info.plist.',
        400,
        'Use an IPA with a valid Info.plist bundle identifier.'
      );
    }

    return bundleId;
  }

  private async rewriteBundleIdentifiers(appPath: string, fromBundleId: string, toBundleId: string): Promise<void> {
    const plistPaths = await this.collectInfoPlists(appPath);

    for (const plistPath of plistPaths) {
      const buffer = await readFile(plistPath).catch(() => undefined);
      if (!buffer) {
        continue;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = parsePlistBuffer(buffer);
      } catch {
        continue;
      }

      const currentBundleId = typeof parsed.CFBundleIdentifier === 'string'
        ? String(parsed.CFBundleIdentifier)
        : undefined;

      if (!currentBundleId) {
        continue;
      }

      const remapped = this.remapBundleIdentifier(currentBundleId, fromBundleId, toBundleId);
      if (remapped === currentBundleId) {
        continue;
      }

      parsed.CFBundleIdentifier = remapped;
      await writeFile(plistPath, plist.build(parsed as any), 'utf8');
    }
  }

  private remapBundleIdentifier(currentBundleId: string, fromBundleId: string, toBundleId: string): string {
    if (currentBundleId === fromBundleId) {
      return toBundleId;
    }

    if (currentBundleId.startsWith(`${fromBundleId}.`)) {
      return `${toBundleId}${currentBundleId.slice(fromBundleId.length)}`;
    }

    return currentBundleId;
  }

  private async collectInfoPlists(root: string): Promise<string[]> {
    const output: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }

        if (entry.isFile() && entry.name === 'Info.plist') {
          output.push(absolute);
        }
      }
    };

    await walk(root);
    return output;
  }

  private async resolveProvisioningProfile(params: {
    appPath: string;
    bundleId: string;
    teamId: string;
  }): Promise<ProvisionResolution> {
    const requestedBundleOverride = this.normalizeBundleId(readEnv(...REAL_BUNDLE_ID_OVERRIDE_ENV_KEYS));

    const explicitProfilePath = readEnv(...REAL_PROVISION_PROFILE_ENV_KEYS);
    if (explicitProfilePath) {
      const explicit = await this.readProvisionProfileCandidate(explicitProfilePath, 'env');
      this.assertProfileTeamMatch(explicit, params.teamId, explicitProfilePath);

      const explicitTarget = requestedBundleOverride ?? params.bundleId;
      if (this.matchesProfileBundle(explicit, explicitTarget, params.teamId)) {
        return {
          profile: explicit,
          effectiveBundleId: explicitTarget,
          reason: requestedBundleOverride ? 'explicit profile + bundle override' : 'explicit profile match'
        };
      }

      const remapped = this.deriveFallbackBundleId(explicit, params.bundleId, params.teamId);
      if (remapped && this.matchesProfileBundle(explicit, remapped, params.teamId)) {
        return {
          profile: explicit,
          effectiveBundleId: remapped,
          reason: 'explicit profile fallback remap'
        };
      }

      throw new AppError(
        'REAL_PROVISION_PROFILE_MISMATCH',
        `Provisioning profile ${explicitProfilePath} does not match team ${params.teamId} and bundle ${explicitTarget}.`,
        400,
        'Set SIDELINK_REAL_PROVISION_PROFILE to a profile that matches your Team ID and bundle identifier (or set SIDELINK_REAL_BUNDLE_ID_OVERRIDE to a bundle ID allowed by that profile).'
      );
    }

    const candidates = await this.collectProvisionProfileCandidates(params.appPath);
    const usable = candidates.filter((candidate) => this.isUsableProfile(candidate, params.teamId));

    if (!usable.length) {
      throw new AppError(
        'REAL_PROVISION_PROFILE_NOT_FOUND',
        `No usable provisioning profiles found for team ${params.teamId}.`,
        400,
        'Open Xcode once with your Apple ID to generate/update local provisioning profiles, or set SIDELINK_REAL_PROVISION_PROFILE to a matching .mobileprovision path.'
      );
    }

    const directTargets = [params.bundleId];
    if (requestedBundleOverride && requestedBundleOverride !== params.bundleId) {
      directTargets.unshift(requestedBundleOverride);
    }

    for (const targetBundleId of directTargets) {
      const direct = this.selectBestMatchingProfile(usable, targetBundleId, params.teamId);
      if (direct) {
        return {
          profile: direct,
          effectiveBundleId: targetBundleId,
          reason: targetBundleId === params.bundleId ? 'direct profile match' : 'bundle override profile match'
        };
      }
    }

    const fallback = this.selectFallbackProfile(usable, params.bundleId, params.teamId);
    if (fallback) {
      return fallback;
    }

    throw new AppError(
      'REAL_PROVISION_PROFILE_NOT_FOUND',
      `No matching provisioning profile found for ${params.bundleId} (team ${params.teamId}).`,
      400,
      'Create or download a provisioning profile for a sideloadable bundle ID under this Team ID, then set SIDELINK_REAL_PROVISION_PROFILE (optional: SIDELINK_REAL_BUNDLE_ID_OVERRIDE).'
    );
  }

  private selectBestMatchingProfile(
    candidates: ProvisionProfileCandidate[],
    bundleId: string,
    teamId: string
  ): ProvisionProfileCandidate | undefined {
    const matches = candidates.filter((candidate) => this.matchesProfileBundle(candidate, bundleId, teamId));
    if (!matches.length) {
      return undefined;
    }

    matches.sort((a, b) => {
      const aScore = this.matchSpecificityScore(a.appIdentifier, bundleId, teamId);
      const bScore = this.matchSpecificityScore(b.appIdentifier, bundleId, teamId);
      if (aScore !== bScore) {
        return bScore - aScore;
      }

      const aExpiry = a.expiresAt?.getTime() ?? 0;
      const bExpiry = b.expiresAt?.getTime() ?? 0;
      return bExpiry - aExpiry;
    });

    return matches[0];
  }

  private selectFallbackProfile(
    candidates: ProvisionProfileCandidate[],
    originalBundleId: string,
    teamId: string
  ): ProvisionResolution | undefined {
    const fallbackOptions = candidates
      .map((profile) => {
        const effectiveBundleId = this.deriveFallbackBundleId(profile, originalBundleId, teamId);
        if (!effectiveBundleId) {
          return undefined;
        }

        if (!this.matchesProfileBundle(profile, effectiveBundleId, teamId)) {
          return undefined;
        }

        return {
          profile,
          effectiveBundleId,
          score: this.fallbackSpecificityScore(profile, teamId),
          reason: 'automatic fallback remap'
        };
      })
      .filter((entry): entry is { profile: ProvisionProfileCandidate; effectiveBundleId: string; score: number; reason: string } => Boolean(entry));

    if (!fallbackOptions.length) {
      return undefined;
    }

    fallbackOptions.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }

      const aExpiry = a.profile.expiresAt?.getTime() ?? 0;
      const bExpiry = b.profile.expiresAt?.getTime() ?? 0;
      return bExpiry - aExpiry;
    });

    const chosen = fallbackOptions[0];
    return {
      profile: chosen.profile,
      effectiveBundleId: chosen.effectiveBundleId,
      reason: chosen.reason
    };
  }

  private fallbackSpecificityScore(profile: ProvisionProfileCandidate, teamId: string): number {
    const suffix = this.extractProfileBundleSuffix(profile, teamId);
    if (!suffix) {
      return 0;
    }

    if (suffix === '*') {
      return 400;
    }

    if (suffix.endsWith('.*')) {
      return 300 + suffix.length;
    }

    if (suffix.includes('.helper')) {
      return 50;
    }

    return 100;
  }

  private deriveFallbackBundleId(profile: ProvisionProfileCandidate, originalBundleId: string, teamId: string): string | undefined {
    const suffix = this.extractProfileBundleSuffix(profile, teamId);
    if (!suffix) {
      return undefined;
    }

    if (suffix === '*') {
      return this.makeGeneratedBundleId('sidelink', originalBundleId);
    }

    if (suffix.endsWith('.*')) {
      const prefix = suffix.slice(0, -2);
      const leaf = this.generateBundleLeaf(originalBundleId);
      return `${prefix}.${leaf}`;
    }

    return suffix;
  }

  private extractProfileBundleSuffix(profile: ProvisionProfileCandidate, teamId: string): string | undefined {
    const appIdentifier = profile.appIdentifier;
    if (!appIdentifier || !appIdentifier.startsWith(`${teamId}.`)) {
      return undefined;
    }

    const suffix = appIdentifier.slice(teamId.length + 1).trim();
    return suffix || undefined;
  }

  private makeGeneratedBundleId(prefix: string, originalBundleId: string): string {
    const normalizedPrefix = this.normalizeBundleId(prefix) ?? 'sidelink';
    const leaf = this.generateBundleLeaf(originalBundleId);
    return `${normalizedPrefix}.${leaf}`;
  }

  private generateBundleLeaf(originalBundleId: string): string {
    const normalized = this.normalizeBundleId(originalBundleId) ?? 'app';
    const tail = normalized
      .split('.')
      .slice(-2)
      .join('-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 24);

    const hash = createHash('sha1').update(originalBundleId).digest('hex').slice(0, 8);
    const base = tail || 'app';
    const leaf = `${base}-${hash}`.replace(/^-+/, 'a-');
    return /^[a-z]/.test(leaf) ? leaf : `a-${leaf}`;
  }

  private normalizeBundleId(input?: string): string | undefined {
    if (!input) {
      return undefined;
    }

    const rawParts = input
      .toLowerCase()
      .replace(/[^a-z0-9.\-]/g, '.')
      .split('.')
      .map((part) => part.replace(/[^a-z0-9\-]/g, '').replace(/^-+/, '').replace(/-+$/, ''))
      .filter(Boolean);

    if (!rawParts.length) {
      return undefined;
    }

    const parts = rawParts.map((part, index) => {
      if (index === 0 && /^[0-9]/.test(part)) {
        return `app-${part}`;
      }

      return part;
    });

    return parts.join('.');
  }

  private async collectProvisionProfileCandidates(appPath: string): Promise<ProvisionProfileCandidate[]> {
    const candidates: ProvisionProfileCandidate[] = [];

    const embeddedPath = path.join(appPath, 'embedded.mobileprovision');
    const embedded = await this.readProvisionProfileCandidate(embeddedPath, 'embedded').catch(() => undefined);
    if (embedded) {
      candidates.push(embedded);
    }

    const profileRoot = path.join(os.homedir(), 'Library', 'MobileDevice', 'Provisioning Profiles');
    const entries = await readdir(profileRoot, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.mobileprovision')) {
        continue;
      }

      const profilePath = path.join(profileRoot, entry.name);
      const parsed = await this.readProvisionProfileCandidate(profilePath, 'library').catch(() => undefined);
      if (parsed) {
        candidates.push(parsed);
      }
    }

    return candidates;
  }

  private async readProvisionProfileCandidate(profilePath: string, source: ProvisionProfileCandidate['source']): Promise<ProvisionProfileCandidate> {
    await access(profilePath);
    const raw = await readFile(profilePath);
    const profile = parseMobileProvision(raw);
    const entitlements = parseMobileProvisionEntitlements(raw);

    const rawTeam = profile.TeamIdentifier;
    const teamIds = Array.isArray(rawTeam)
      ? rawTeam.map((value) => String(value)).filter(Boolean)
      : rawTeam
        ? [String(rawTeam)]
        : [];

    const appIdentifier = typeof entitlements['application-identifier'] === 'string'
      ? String(entitlements['application-identifier'])
      : undefined;

    const expirationRaw = profile.ExpirationDate;
    const expiresAt = expirationRaw instanceof Date
      ? expirationRaw
      : expirationRaw
        ? new Date(String(expirationRaw))
        : undefined;

    return {
      path: profilePath,
      entitlements,
      appIdentifier,
      teamIds,
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : undefined,
      source
    };
  }

  private isUsableProfile(profile: ProvisionProfileCandidate, teamId: string): boolean {
    if (profile.expiresAt && profile.expiresAt.getTime() < Date.now()) {
      return false;
    }

    if (profile.teamIds.length && !profile.teamIds.includes(teamId)) {
      return false;
    }

    return typeof profile.appIdentifier === 'string' && profile.appIdentifier.length > 0;
  }

  private assertProfileTeamMatch(profile: ProvisionProfileCandidate, teamId: string, profilePath: string): void {
    if (profile.teamIds.length && !profile.teamIds.includes(teamId)) {
      throw new AppError(
        'REAL_PROVISION_PROFILE_MISMATCH',
        `Provisioning profile ${profilePath} is not for team ${teamId}.`,
        400,
        'Use a provisioning profile for the same Team ID as your selected signing identity.'
      );
    }
  }

  private matchesProfileBundle(profile: ProvisionProfileCandidate, bundleId: string, teamId: string): boolean {
    if (!profile.appIdentifier) {
      return false;
    }

    if (!profile.appIdentifier.startsWith(`${teamId}.`)) {
      return false;
    }

    const suffix = profile.appIdentifier.slice(teamId.length + 1);
    if (suffix === '*') {
      return true;
    }

    if (suffix.endsWith('.*')) {
      const prefix = suffix.slice(0, -2);
      return bundleId === prefix || bundleId.startsWith(`${prefix}.`);
    }

    return suffix === bundleId;
  }

  private matchSpecificityScore(appIdentifier: string | undefined, bundleId: string, teamId: string): number {
    if (!appIdentifier) {
      return 0;
    }

    if (appIdentifier === `${teamId}.${bundleId}`) {
      return 3;
    }

    if (appIdentifier.endsWith('.*')) {
      return 2;
    }

    if (appIdentifier.endsWith('*')) {
      return 1;
    }

    return 0;
  }

  private buildSigningEntitlements(params: {
    bundleId: string;
    teamId: string;
    profileEntitlements: Record<string, unknown>;
  }): Record<string, unknown> {
    const entitlements: Record<string, unknown> = { ...params.profileEntitlements };

    Object.keys(entitlements)
      .filter((key) => key.startsWith('com.apple.private.') || key === 'beta-reports-active')
      .forEach((key) => {
        delete entitlements[key];
      });

    const appIdentifier = `${params.teamId}.${params.bundleId}`;

    entitlements['application-identifier'] = appIdentifier;
    entitlements['com.apple.developer.team-identifier'] = params.teamId;
    entitlements['get-task-allow'] = true;

    const keychainGroups = Array.isArray(entitlements['keychain-access-groups'])
      ? (entitlements['keychain-access-groups'] as unknown[])
          .map((item) => String(item).trim())
          .filter(Boolean)
          .map((group) => this.normalizeTeamPrefix(group, params.teamId))
      : [];

    if (!keychainGroups.length) {
      keychainGroups.push(appIdentifier);
    }

    entitlements['keychain-access-groups'] = Array.from(new Set(keychainGroups));

    return entitlements;
  }

  private normalizeTeamPrefix(value: string, teamId: string): string {
    if (!value) {
      return value;
    }

    if (value.startsWith('$(AppIdentifierPrefix)')) {
      return value.replace('$(AppIdentifierPrefix)', `${teamId}.`);
    }

    if (value.startsWith('$(TeamIdentifierPrefix)')) {
      return value.replace('$(TeamIdentifierPrefix)', `${teamId}.`);
    }

    return value;
  }

  private extractTeamId(identity: string): string | undefined {
    const match = identity.match(/\(([A-Z0-9]{10})\)\s*$/);
    return match?.[1];
  }

  private async recordNote(audit: CommandAuditWriter | undefined, note: string): Promise<void> {
    if (!audit) {
      return;
    }

    const now = new Date().toISOString();
    await audit({
      command: 'signing-context',
      args: [],
      startedAt: now,
      endedAt: now,
      status: 'success',
      exitCode: 0,
      note
    });
  }

  private async runAudited(
    invocation: { command: string; args: string[]; timeoutMs?: number; cwd?: string },
    audit?: CommandAuditWriter
  ) {
    const result = await this.runner.execute({
      command: invocation.command,
      args: invocation.args,
      timeoutMs: invocation.timeoutMs,
      cwd: invocation.cwd
    });

    if (audit) {
      await audit({
        command: result.command,
        args: result.args,
        cwd: result.cwd,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        exitCode: result.code,
        status: result.code === 0 ? 'success' : 'error',
        stdout: result.stdout,
        stderr: result.stderr
      });
    }

    return result;
  }

  private assertIdentityCompliance(identity: string): void {
    const normalized = identity.toLowerCase();

    if (normalized.includes('enterprise') || normalized.includes('in-house') || normalized.includes('distribution')) {
      throw new AppError('NON_COMPLIANT_SIGNING_IDENTITY', `Identity "${identity}" is blocked. ${complianceError}`, 400, complianceError);
    }

    if (!/(apple development|iphone developer)/i.test(identity)) {
      throw new AppError(
        'UNSUPPORTED_SIGNING_IDENTITY',
        `Identity "${identity}" is not an Apple Development identity.`,
        400,
        complianceError
      );
    }
  }
}
