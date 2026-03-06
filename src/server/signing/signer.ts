// ─── IPA Signer ─────────────────────────────────────────────────────
// Signs IPAs using certificates and provisioning profiles obtained
// from Apple's Developer Services (not from a pre-existing keychain).
//
// Flow:
//   1. Unpack IPA
//   2. Rewrite bundle identifiers (to match provisioning profile)
//   3. Embed provisioning profile
//   4. Build entitlements
//   5. Import cert+key into temporary keychain
//   6. codesign with the temp keychain identity
//   7. Verify signature
//   8. Repack into signed IPA
//   9. Cleanup temp keychain

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { runCommand, runCommandStrict, commandExists } from '../utils/command';
import { parsePlistFile, writePlistFile, parseMobileProvision, buildPlist } from '../utils/plist';
import { SigningError } from '../utils/errors';
import type { SigningParams, SigningResult, CommandAuditWriter } from '../types';
import { STRIP_ENTITLEMENT_PREFIXES, STRIP_ENTITLEMENT_KEYS, rewriteBundleIdentifiers, findInfoPlists, buildSigningEntitlements } from './signing-utils';

// ─── Constants ──────────────────────────────────────────────────────

const CODESIGN_TIMEOUT = 120_000;
const KEYCHAIN_PASSWORD = 'sidelink-temp'; // temp keychain doesn't need real security

// Constants, entitlement building, bundle-ID rewriting, and Info.plist
// helpers are shared with ts-signer.ts via ./signing-utils.

// ─── Main Sign Function ─────────────────────────────────────────────

/**
 * Sign an IPA with Apple-provided credentials.
 */
export async function signIpa(
  params: SigningParams,
  audit?: CommandAuditWriter,
  jobId?: string,
): Promise<SigningResult> {
  // Verify codesign is available
  if (!(await commandExists('codesign'))) {
    throw new SigningError('CODESIGN_NOT_FOUND', 'codesign not found. Xcode Command Line Tools required.');
  }

  // Clean up any stale sidelink keychains from previous crashed runs.
  // If left behind, macOS sees duplicate identities and codesign fails
  // with "ambiguous" errors.
  await cleanupStaleKeychains();

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidelink-sign-'));
  const keychainPath = path.join(workDir, 'signing.keychain-db');
  let keychainCreated = false;

  const auditCmd = (cmd: string, args: string[], result: any) => {
    if (audit && jobId) {
      audit({
        jobId,
        command: cmd,
        args,
        cwd: workDir,
        exitCode: result.exitCode ?? 0,
        stdout: (result.stdout ?? '').slice(0, 10000),
        stderr: (result.stderr ?? '').slice(0, 10000),
        durationMs: result.durationMs ?? 0,
        notes: null,
      });
    }
  };

  try {
    // ── Step 1: Unpack IPA ────────────────────────────────────────

    const unpackDir = path.join(workDir, 'unpack');
    await fs.mkdir(unpackDir, { recursive: true });

    const unzipResult = await runCommandStrict('unzip', {
      args: ['-q', '-o', params.ipaPath, '-d', unpackDir],
      timeoutMs: 60_000,
    });
    auditCmd('unzip', ['-q', '-o', params.ipaPath, '-d', unpackDir], unzipResult);

    // ── Step 2: Find .app bundle ──────────────────────────────────

    const payloadDir = path.join(unpackDir, 'Payload');
    const entries = await fs.readdir(payloadDir);
    const appDir = entries.find(e => e.endsWith('.app'));
    if (!appDir) {
      throw new SigningError('APP_BUNDLE_NOT_FOUND', 'No .app bundle found in IPA Payload/');
    }
    const appPath = path.join(payloadDir, appDir);

    // ── Step 3: Read original bundle ID ───────────────────────────

    const infoPlistPath = path.join(appPath, 'Info.plist');
    const infoPlist = await parsePlistFile(infoPlistPath);
    const originalBundleId = String(infoPlist['CFBundleIdentifier'] || '');

    // ── Step 4: Rewrite bundle IDs ────────────────────────────────

    if (params.targetBundleId !== originalBundleId) {
      await rewriteBundleIdentifiers(appPath, originalBundleId, params.targetBundleId);
    }

    // ── Step 5: Embed provisioning profile ────────────────────────

    const profileDest = path.join(appPath, 'embedded.mobileprovision');
    await fs.writeFile(profileDest, params.provisioningProfileData);

    // If extensions are not included, remove PlugIns so the final IPA
    // doesn't contain unprovisioned extension bundles.
    if (!params.includeExtensions) {
      const pluginsPath = path.join(appPath, 'PlugIns');
      await fs.rm(pluginsPath, { recursive: true, force: true }).catch(() => {});
    }

    // ── Step 6: Build entitlements ────────────────────────────────

    const profilePlist = parseMobileProvision(params.provisioningProfileData);
    const profileEntitlements = (profilePlist['Entitlements'] || {}) as Record<string, unknown>;

    const entitlements = buildSigningEntitlements(
      profileEntitlements,
      params.teamId,
      params.targetBundleId,
      params.entitlements,
    );

    const entitlementsPath = path.join(workDir, 'entitlements.plist');
    await writePlistFile(entitlementsPath, entitlements);

    // ── Step 7: Create temporary keychain & import identity ───────

    // Create keychain
    await runCommandStrict('security', {
      args: ['create-keychain', '-p', KEYCHAIN_PASSWORD, keychainPath],
      timeoutMs: 15_000,
    });
    keychainCreated = true;

    // Set keychain settings (no auto-lock)
    await runCommandStrict('security', {
      args: ['set-keychain-settings', keychainPath],
      timeoutMs: 10_000,
    });

    // Unlock keychain
    await runCommandStrict('security', {
      args: ['unlock-keychain', '-p', KEYCHAIN_PASSWORD, keychainPath],
      timeoutMs: 10_000,
    });

    // Write cert and key to temp files
    const certFile = path.join(workDir, 'cert.pem');
    const keyFile = path.join(workDir, 'key.pem');
    await fs.writeFile(certFile, params.certificatePem, 'utf8');
    await fs.writeFile(keyFile, params.privateKeyPem, 'utf8');

    // Convert PEM cert+key to PKCS12
    // IMPORTANT: OpenSSL 3.x defaults to AES-256-CBC which macOS's
    // `security import` doesn't understand. We must use legacy algorithms
    // (3DES + SHA1) for Keychain compatibility.
    const p12File = path.join(workDir, 'identity.p12');
    const p12Password = crypto.randomBytes(16).toString('hex');

    const p12Result = await runCommandStrict('openssl', {
      args: [
        'pkcs12', '-export',
        '-legacy',
        '-inkey', keyFile,
        '-in', certFile,
        '-out', p12File,
        '-passout', `pass:${p12Password}`,
      ],
      timeoutMs: 15_000,
    });
    auditCmd('openssl', ['pkcs12', '-export', '-in', certFile, '-out', p12File], p12Result);

    // Import PKCS12 into temp keychain
    const importResult = await runCommandStrict('security', {
      args: [
        'import', p12File,
        '-k', keychainPath,
        '-P', p12Password,
        '-T', '/usr/bin/codesign',
        '-T', '/usr/bin/security',
      ],
      timeoutMs: 15_000,
    });
    auditCmd('security', ['import', p12File, '-k', keychainPath], importResult);

    // Allow codesign to access the keychain without prompting
    await runCommandStrict('security', {
      args: ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', KEYCHAIN_PASSWORD, keychainPath],
      timeoutMs: 10_000,
    });

    // Add temp keychain to search list
    const listResult = await runCommand('security', { args: ['list-keychains', '-d', 'user'] });
    const currentKeychains = listResult.stdout
      .split('\n')
      .map(l => l.trim().replace(/^"|"$/g, ''))
      .filter(l => l.length > 0);

    await runCommandStrict('security', {
      args: ['list-keychains', '-d', 'user', '-s', keychainPath, ...currentKeychains],
      timeoutMs: 10_000,
    });

    // ── Step 8: Find signing identity ─────────────────────────────

    const identityResult = await runCommand('security', {
      args: ['find-identity', '-v', '-p', 'codesigning', keychainPath],
      timeoutMs: 15_000,
    });

    const identityMatch = identityResult.stdout.match(/"([^"]+)"/);
    if (!identityMatch) {
      throw new SigningError(
        'SIGNING_IDENTITY_NOT_FOUND',
        'Could not find signing identity in temp keychain. Certificate may be invalid.',
      );
    }
    const signingIdentity = identityMatch[1];

    // ── Step 9: Code sign ─────────────────────────────────────────

    // Sign all frameworks, dylibs, and app extensions first.
    // Extensions get per-extension entitlements with the correct bundle ID.
    await signNestedContent(appPath, signingIdentity, keychainPath, {
      profileEntitlements,
      profileData: params.provisioningProfileData,
      teamId: params.teamId,
      mainBundleId: params.targetBundleId,
      workDir,
      extensionProfiles: params.extensionProfiles,
    }, auditCmd);

    // Sign the main app — no --deep since all nested content is already signed
    const signArgs = [
      '-f',
      '--generate-entitlement-der',
      '-s', signingIdentity,
      '--keychain', keychainPath,
      '--entitlements', entitlementsPath,
      appPath,
    ];

    const signResult = await runCommandStrict('codesign', {
      args: signArgs,
      timeoutMs: CODESIGN_TIMEOUT,
    });
    auditCmd('codesign', signArgs, signResult);

    // ── Step 10: Verify ───────────────────────────────────────────

    const verifyResult = await runCommand('codesign', {
      args: ['--verify', '--deep', '--strict', appPath],
      timeoutMs: 30_000,
    });
    auditCmd('codesign', ['--verify', '--deep', '--strict', appPath], verifyResult);

    if (verifyResult.exitCode !== 0) {
      throw new SigningError(
        'SIGNATURE_VERIFICATION_FAILED',
        `Signed app failed verification: ${verifyResult.stderr.trim()}`,
      );
    }

    // ── Step 11: Repack IPA ───────────────────────────────────────

    const signedIpaPath = path.join(workDir, 'signed.ipa');
    const zipResult = await runCommandStrict('zip', {
      args: ['-qry', signedIpaPath, 'Payload'],
      cwd: unpackDir,
      timeoutMs: 60_000,
    });
    auditCmd('zip', ['-qry', signedIpaPath, 'Payload'], zipResult);

    // Cleanup sensitive files
    await fs.unlink(keyFile).catch(() => {});
    await fs.unlink(certFile).catch(() => {});
    await fs.unlink(p12File).catch(() => {});

    return {
      signedIpaPath,
      effectiveBundleId: params.targetBundleId,
      effectiveTeamId: params.teamId,
      workDir,
      cleanup: async () => {
        // Remove temp keychain
        if (keychainCreated) {
          await runCommand('security', { args: ['delete-keychain', keychainPath] }).catch(() => {});
          // Restore original keychain list
          await runCommand('security', {
            args: ['list-keychains', '-d', 'user', '-s', ...currentKeychains],
          }).catch(() => {});
        }
        // Remove work directory
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (error) {
    // Cleanup on failure
    if (keychainCreated) {
      await runCommand('security', { args: ['delete-keychain', keychainPath] }).catch(() => {});
    }
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

// ─── Bundle ID Rewriting ────────────────────────────────────────────

/**
 * Recursively rewrite all Info.plist bundle identifiers in an app bundle.
 */

// rewriteBundleIdentifiers, findInfoPlists, and buildSigningEntitlements
// are imported from ./signing-utils (shared with ts-signer.ts).

// ─── Nested Content Signing ─────────────────────────────────────────

/**
 * Remove any leftover sidelink temp keychains from the search list
 * and delete them. These accumulate when the server crashes mid-sign.
 */
async function cleanupStaleKeychains(): Promise<void> {
  try {
    // Get current keychain search list
    const listResult = await runCommand('security', { args: ['list-keychains', '-d', 'user'] });
    const keychains = listResult.stdout
      .split('\n')
      .map(l => l.trim().replace(/^"|"$/g, ''))
      .filter(l => l.length > 0);

    const stale = keychains.filter(k => k.includes('sidelink-sign-'));
    if (stale.length === 0) return;

    console.log(`[SIGNER] Cleaning up ${stale.length} stale keychain(s)`);

    // Delete each stale keychain
    for (const kc of stale) {
      await runCommand('security', { args: ['delete-keychain', kc] }).catch(() => {});
    }

    // Restore search list without the stale ones
    const clean = keychains.filter(k => !k.includes('sidelink-sign-'));
    if (clean.length > 0) {
      await runCommand('security', {
        args: ['list-keychains', '-d', 'user', '-s', ...clean],
      }).catch(() => {});
    }
  } catch {
    // Non-fatal — best-effort cleanup
  }
}

interface NestedSigningContext {
  profileEntitlements: Record<string, unknown>;
  profileData: Buffer;
  teamId: string;
  mainBundleId: string;
  workDir: string;
  extensionProfiles?: Array<{ bundleId: string; profileData: Buffer }>;
}

/**
 * Sign all frameworks, dylibs, and app extensions inside the main app bundle.
 * Extensions get per-extension entitlements with the correct application-identifier.
 */
async function signNestedContent(
  appPath: string,
  identity: string,
  keychainPath: string,
  ctx: NestedSigningContext,
  auditCmd: (cmd: string, args: string[], result: any) => void,
): Promise<void> {
  // Sign Frameworks/dylibs (no entitlements needed)
  await signFrameworksInDir(appPath, identity, keychainPath, auditCmd);

  // Sign PlugIns (app extensions) with per-extension entitlements
  const pluginsDir = path.join(appPath, 'PlugIns');
  try {
    const plugins = await fs.readdir(pluginsDir);
    for (const plugin of plugins) {
      if (!plugin.endsWith('.appex')) continue;
      await signAppExtension(
        path.join(pluginsDir, plugin), identity, keychainPath, ctx, auditCmd,
      );
    }
  } catch {
    // No PlugIns directory
  }

  // Sign Watch content if present
  const watchDir = path.join(appPath, 'Watch');
  try {
    const watchApps = await fs.readdir(watchDir);
    for (const wa of watchApps) {
      if (!wa.endsWith('.app')) continue;
      const watchAppPath = path.join(watchDir, wa);
      // Sign frameworks inside the watch app
      await signFrameworksInDir(watchAppPath, identity, keychainPath, auditCmd);
      // Sign watch app extensions
      const watchPlugins = path.join(watchAppPath, 'PlugIns');
      try {
        for (const p of await fs.readdir(watchPlugins)) {
          if (p.endsWith('.appex')) {
            await signAppExtension(
              path.join(watchPlugins, p), identity, keychainPath, ctx, auditCmd,
            );
          }
        }
      } catch { /* no watch plugins */ }
      // Sign the watch app itself
      let watchBundleId = ctx.mainBundleId + '.watchkitapp';
      try {
        const plist = await parsePlistFile(path.join(watchAppPath, 'Info.plist'));
        watchBundleId = String(plist['CFBundleIdentifier'] || watchBundleId);
      } catch { /* use fallback */ }
      const ent = buildSigningEntitlements(ctx.profileEntitlements, ctx.teamId, watchBundleId);
      const entPath = path.join(ctx.workDir, `entitlements-${wa}.plist`);
      await writePlistFile(entPath, ent);
      await fs.writeFile(path.join(watchAppPath, 'embedded.mobileprovision'), ctx.profileData);
      const args = [
        '-f', '--generate-entitlement-der',
        '-s', identity, '--keychain', keychainPath,
        '--entitlements', entPath, watchAppPath,
      ];
      const result = await runCommand('codesign', { args, timeoutMs: CODESIGN_TIMEOUT });
      auditCmd('codesign', args, result);
    }
  } catch {
    // No Watch directory
  }
}

/**
 * Sign all .framework and .dylib entries in a bundle's Frameworks/ folder.
 */
async function signFrameworksInDir(
  bundlePath: string,
  identity: string,
  keychainPath: string,
  auditCmd: (cmd: string, args: string[], result: any) => void,
): Promise<void> {
  const frameworksDir = path.join(bundlePath, 'Frameworks');
  try {
    const entries = await fs.readdir(frameworksDir);
    for (const entry of entries) {
      const entryPath = path.join(frameworksDir, entry);
      const args = ['-f', '-s', identity, '--keychain', keychainPath, entryPath];
      const result = await runCommand('codesign', { args, timeoutMs: CODESIGN_TIMEOUT });
      auditCmd('codesign', args, result);
    }
  } catch {
    // No Frameworks directory
  }
}

/**
 * Sign a single .appex extension with its own entitlements.
 * Reads the extension's bundle ID from its Info.plist, builds
 * specific entitlements, embeds the provisioning profile, and signs.
 */
async function signAppExtension(
  extPath: string,
  identity: string,
  keychainPath: string,
  ctx: NestedSigningContext,
  auditCmd: (cmd: string, args: string[], result: any) => void,
): Promise<void> {
  const extName = path.basename(extPath);

  // Read extension's bundle ID from its Info.plist
  let extBundleId = ctx.mainBundleId + '.' + extName.replace('.appex', '');
  try {
    const plist = await parsePlistFile(path.join(extPath, 'Info.plist'));
    extBundleId = String(plist['CFBundleIdentifier'] || extBundleId);
  } catch { /* use fallback */ }

  // Find the matching extension profile, or fall back to main profile
  const profileEntry = ctx.extensionProfiles?.find(ep => ep.bundleId === extBundleId);
  const profileData = profileEntry?.profileData ?? ctx.profileData;

  // Build entitlements from the extension's own profile
  const extProfilePlist = parseMobileProvision(profileData);
  const extProfileEntitlements = (extProfilePlist['Entitlements'] || {}) as Record<string, unknown>;
  const extEntitlements = buildSigningEntitlements(
    extProfileEntitlements, ctx.teamId, extBundleId,
  );
  const extEntPath = path.join(ctx.workDir, `entitlements-${extName}.plist`);
  await writePlistFile(extEntPath, extEntitlements);

  // Embed provisioning profile (use extension-specific if available)
  await fs.writeFile(path.join(extPath, 'embedded.mobileprovision'), profileData);

  // Sign frameworks inside the extension first
  await signFrameworksInDir(extPath, identity, keychainPath, auditCmd);

  // Sign the extension itself
  const args = [
    '-f', '--generate-entitlement-der',
    '-s', identity, '--keychain', keychainPath,
    '--entitlements', extEntPath, extPath,
  ];
  const result = await runCommand('codesign', { args, timeoutMs: CODESIGN_TIMEOUT });
  auditCmd('codesign', args, result);
}
