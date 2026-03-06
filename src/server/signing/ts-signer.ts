// ─── Cross-Platform IPA Signer ──────────────────────────────────────
// Pure TypeScript implementation that replaces the macOS-specific
// `codesign` + Keychain pipeline. Works on macOS, Windows, and Linux.
//
// Flow:
//   1. Unpack IPA (using adm-zip, no shell `unzip`)
//   2. Rewrite bundle identifiers
//   3. Embed provisioning profile
//   4. Build entitlements (XML plist + DER)
//   5. Generate CodeResources (_CodeSignature)
//   6. Build CodeDirectory (page hashes of executable)
//   7. Create CMS signature (using node-forge PKCS#7)
//   8. Embed code signature into Mach-O binary
//   9. Repack into signed IPA
//
// No external tools required: no codesign, no security, no openssl.

import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { v4 as uuid } from 'uuid';
import { parsePlistFile, writePlistFile, parseMobileProvision, buildPlist, parsePlistBuffer } from '../utils/plist';
import { SigningError } from '../utils/errors';
import type { SigningParams, SigningResult, CommandAuditWriter } from '../types';
import {
  parseMachO, getExecutableSize, findLinkeditSegment,
  LC_CODE_SIGNATURE, LC_SEGMENT_64, LC_SEGMENT,
  type MachOSlice,
} from './macho';
import {
  buildCodeDirectory, buildEntitlementsBlob,
  buildEmptyRequirements,
  buildSuperBlob, createCMSSignature, computeCodeHashes, computeSpecialSlotHash,
  CSSLOT_CODEDIRECTORY, CSSLOT_INFOSLOT, CSSLOT_REQUIREMENTS, CSSLOT_RESOURCEDIR,
  CSSLOT_ENTITLEMENTS, CSSLOT_SIGNATURESLOT,
  CSSLOT_ALTERNATE_CODEDIRECTORIES,
  CS_HASHTYPE_SHA1, CS_HASHTYPE_SHA256, CS_PAGE_SIZE,
} from './codesign-structures';
import {
  STRIP_ENTITLEMENT_PREFIXES, STRIP_ENTITLEMENT_KEYS,
  rewriteBundleIdentifiers, findInfoPlists, buildSigningEntitlements,
} from './signing-utils';

// ─── Module Logger ──────────────────────────────────────────────────
interface SignerLogger { warn(msg: string): void; info(msg: string): void; }
let signerLog: SignerLogger = {
  warn: (msg) => console.warn(`[TS-SIGNER] ${msg}`),
  info: (msg) => console.log(`[TS-SIGNER] ${msg}`),
};
export function setSignerLogger(l: SignerLogger): void { signerLog = l; }

/**
 * Scan an IPA to discover extension bundle IDs without a full unpack.
 * Returns the original (pre-rewrite) bundle IDs from PlugIns/*.appex/Info.plist.
 */
export async function scanIpaExtensions(ipaPath: string): Promise<string[]> {
  const zip = new AdmZip(ipaPath);
  const entries = zip.getEntries();
  const bundleIds: string[] = [];

  for (const entry of entries) {
    if (/^Payload\/[^/]+\.app\/PlugIns\/[^/]+\.appex\/Info\.plist$/.test(entry.entryName)) {
      try {
        const plist = parsePlistBuffer(entry.getData());
        const bid = String(plist['CFBundleIdentifier'] || '');
        if (bid) bundleIds.push(bid);
      } catch { /* skip unparseable */ }
    }
  }

  return bundleIds;
}

// Constants, entitlement building, bundle-ID rewriting, and Info.plist
// helpers are imported from ./signing-utils (shared with signer.ts).

// ─── Main Sign Function ─────────────────────────────────────────────

/**
 * Sign an IPA with Apple-provided credentials.
 * Pure TypeScript — no macOS tools required.
 */
export async function signIpa(
  params: SigningParams,
  audit?: CommandAuditWriter,
  jobId?: string,
): Promise<SigningResult> {
  const startTime = Date.now();
  const workDir = path.join(os.tmpdir(), `sidelink-sign-${uuid()}`);
  await fs.mkdir(workDir, { recursive: true });

  const auditStep = (step: string, details: string, durationMs: number) => {
    if (audit && jobId) {
      audit({
        jobId,
        command: 'ts-signer',
        args: [step],
        cwd: workDir,
        exitCode: 0,
        stdout: details.slice(0, 10000),
        stderr: '',
        durationMs,
        notes: null,
      });
    }
  };

  try {
    // ── Step 1: Unpack IPA ────────────────────────────────────────
    let stepStart = Date.now();
    const unpackDir = path.join(workDir, 'unpack');
    await fs.mkdir(unpackDir, { recursive: true });

    const zip = new AdmZip(params.ipaPath);
    zip.extractAllTo(unpackDir, true);
    auditStep('unpack', `Extracted IPA to ${unpackDir}`, Date.now() - stepStart);

    // ── Step 2: Find .app bundle ──────────────────────────────────
    const payloadDir = path.join(unpackDir, 'Payload');
    const entries = await fs.readdir(payloadDir);
    const appDirName = entries.find(e => e.endsWith('.app'));
    if (!appDirName) {
      throw new SigningError('APP_BUNDLE_NOT_FOUND', 'No .app bundle found in IPA Payload/');
    }
    const appPath = path.join(payloadDir, appDirName);

    // ── Step 3: Read original bundle ID ───────────────────────────
    const infoPlistPath = path.join(appPath, 'Info.plist');
    const infoPlist = await parsePlistFile(infoPlistPath);
    const originalBundleId = String(infoPlist['CFBundleIdentifier'] || '');
    const executableName = String(infoPlist['CFBundleExecutable'] || appDirName.replace('.app', ''));

    // ── Step 4: Rewrite bundle IDs ────────────────────────────────
    stepStart = Date.now();
    if (params.targetBundleId !== originalBundleId) {
      await rewriteBundleIdentifiers(appPath, originalBundleId, params.targetBundleId);
    }
    auditStep('rewrite-bundle-id', `${originalBundleId} → ${params.targetBundleId}`, Date.now() - stepStart);

    // ── Step 5: Embed provisioning profile ────────────────────────
    stepStart = Date.now();
    const profileDest = path.join(appPath, 'embedded.mobileprovision');
    await fs.writeFile(profileDest, params.provisioningProfileData);
    auditStep('embed-profile', 'Wrote embedded.mobileprovision', Date.now() - stepStart);

    // ── Step 6: Build entitlements ────────────────────────────────
    stepStart = Date.now();
    const profilePlist = parseMobileProvision(params.provisioningProfileData);
    const profileEntitlements = (profilePlist['Entitlements'] || {}) as Record<string, unknown>;

    const entitlements = buildSigningEntitlements(
      profileEntitlements,
      params.teamId,
      params.targetBundleId,
      params.entitlements,
    );

    const entitlementsPlistXml = buildPlist(entitlements);
    const entitlementsPath = path.join(workDir, 'entitlements.plist');
    await fs.writeFile(entitlementsPath, entitlementsPlistXml, 'utf8');
    auditStep('build-entitlements', `Built entitlements for ${params.targetBundleId}`, Date.now() - stepStart);

    // ── Step 7: Sign nested content (Frameworks, PlugIns) ─────────
    stepStart = Date.now();
    // If extensions are not included, remove the PlugIns directory entirely
    // so the signed IPA doesn't contain unprovisionable extensions.
    if (!params.includeExtensions) {
      const plugInsPath = path.join(appPath, 'PlugIns');
      await fs.rm(plugInsPath, { recursive: true, force: true }).catch(() => {});
    }
    await signNestedContent(appPath, params);
    auditStep('sign-nested', 'Signed frameworks and plugins', Date.now() - stepStart);

    // ── Step 8: Build CodeResources ───────────────────────────────
    stepStart = Date.now();
    const codeResourcesXml = await buildCodeResources(appPath, executableName);
    const codeResourcesDir = path.join(appPath, '_CodeSignature');
    await fs.mkdir(codeResourcesDir, { recursive: true });
    await fs.writeFile(path.join(codeResourcesDir, 'CodeResources'), codeResourcesXml, 'utf8');
    auditStep('code-resources', 'Generated CodeResources', Date.now() - stepStart);

    // ── Step 9: Sign the main executable ──────────────────────────
    stepStart = Date.now();
    const executablePath = path.join(appPath, executableName);
    // Read the final Info.plist bytes for the special slot 1 hash
    const infoPlistRawData = await fs.readFile(infoPlistPath);
    const signingParamsWithPlist: SigningParams = { ...params, infoPlistData: infoPlistRawData };
    await signMachOBinary(executablePath, signingParamsWithPlist, entitlementsPlistXml, codeResourcesXml);
    auditStep('sign-executable', `Signed ${executableName}`, Date.now() - stepStart);

    // ── Step 10: Repack IPA ───────────────────────────────────────
    stepStart = Date.now();
    const signedIpaPath = path.join(workDir, 'signed.ipa');
    await repackIpa(unpackDir, signedIpaPath);
    auditStep('repack', `Repacked to ${signedIpaPath}`, Date.now() - stepStart);

    const totalDuration = Date.now() - startTime;
    auditStep('complete', `Signing completed in ${totalDuration}ms`, totalDuration);

    return {
      signedIpaPath,
      effectiveBundleId: params.targetBundleId,
      effectiveTeamId: params.teamId,
      workDir,
      cleanup: async () => {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (error) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

// ─── Mach-O Code Signing ────────────────────────────────────────────

/**
 * Sign a Mach-O binary by building and embedding a code signature.
 */
async function signMachOBinary(
  binaryPath: string,
  params: SigningParams,
  entitlementsPlistXml: string,
  codeResourcesXml: string,
): Promise<void> {
  let resultBuffer: Buffer = await fs.readFile(binaryPath) as Buffer;

  // For FAT binaries, signing one slice changes the buffer layout,
  // so we must re-parse after each slice to get correct offsets.
  const macho = parseMachO(resultBuffer);
  for (let i = 0; i < macho.slices.length; i++) {
    const currentMacho = i === 0 ? macho : parseMachO(resultBuffer);
    const slice = currentMacho.slices[i];
    resultBuffer = await signSlice(
      resultBuffer, slice, params, entitlementsPlistXml, codeResourcesXml,
    );
  }

  await fs.writeFile(binaryPath, resultBuffer);
}

/**
 * Sign a single Mach-O slice (one architecture in a FAT binary).
 *
 * Uses a two-pass approach to solve the chicken-and-egg problem:
 * code hashes cover the load-command region, but embedSignature must
 * update LC_CODE_SIGNATURE.datasize and __LINKEDIT there. So we:
 *   Pass 1 → build a draft SuperBlob to learn its exact size
 *   Stamp  → write the final LC_CODE_SIGNATURE + __LINKEDIT into the buffer
 *   Pass 2 → re-hash the stamped buffer and build the real SuperBlob
 */
async function signSlice(
  fileBuffer: Buffer,
  slice: MachOSlice,
  params: SigningParams,
  entitlementsPlistXml: string,
  codeResourcesXml: string,
): Promise<Buffer> {
  const identifier = params.targetBundleId;
  const infoPlistData = params.infoPlistData;
  const resourcesData = Buffer.from(codeResourcesXml, 'utf8');

  const entitlementsBlob = buildEntitlementsBlob(entitlementsPlistXml);
  const requirementsBlob = buildEmptyRequirements();

  const codeLimit = getExecutableSize(slice);
  const alignedOffset = Math.ceil(codeLimit / 16) * 16;
  const paddingSize = alignedOffset - codeLimit;

  // ── Helper: build special-slot hashes for a given hash type ──
  function buildSpecialHashes(hashType: number): Map<number, Buffer> {
    const m = new Map<number, Buffer>();
    if (infoPlistData) {
      m.set(CSSLOT_INFOSLOT, computeSpecialSlotHash(infoPlistData, hashType));
    }
    m.set(CSSLOT_REQUIREMENTS, computeSpecialSlotHash(requirementsBlob, hashType));
    m.set(CSSLOT_RESOURCEDIR, computeSpecialSlotHash(resourcesData, hashType));
    m.set(CSSLOT_ENTITLEMENTS, computeSpecialSlotHash(entitlementsBlob, hashType));
    return m;
  }

  // ── Helper: build a complete SuperBlob from executable bytes ──
  function buildSignatureBlob(execData: Buffer): Buffer {
    const sha256Hashes = computeCodeHashes(execData, CS_PAGE_SIZE, CS_HASHTYPE_SHA256);
    const sha1Hashes = computeCodeHashes(execData, CS_PAGE_SIZE, CS_HASHTYPE_SHA1);

    const codeDir256 = buildCodeDirectory({
      identifier,
      teamId: params.teamId,
      hashType: CS_HASHTYPE_SHA256,
      codeLimit,
      pageSize: CS_PAGE_SIZE,
      codeHashes: sha256Hashes,
      specialHashes: buildSpecialHashes(CS_HASHTYPE_SHA256),
      flags: 0,
    });

    const codeDir1 = buildCodeDirectory({
      identifier,
      teamId: params.teamId,
      hashType: CS_HASHTYPE_SHA1,
      codeLimit,
      pageSize: CS_PAGE_SIZE,
      codeHashes: sha1Hashes,
      specialHashes: buildSpecialHashes(CS_HASHTYPE_SHA1),
      flags: 0,
    });

    // CMS signs the primary (SHA-256) CodeDirectory
    const cmsSignature = createCMSSignature(
      codeDir256,
      params.certificatePem,
      params.privateKeyPem,
    );

    const blobs = new Map<number, Buffer>();
    blobs.set(CSSLOT_CODEDIRECTORY, codeDir256);                 // Primary: SHA-256
    blobs.set(CSSLOT_REQUIREMENTS, requirementsBlob);
    blobs.set(CSSLOT_ENTITLEMENTS, entitlementsBlob);
    blobs.set(CSSLOT_ALTERNATE_CODEDIRECTORIES, codeDir1);       // Alternate: SHA-1
    blobs.set(CSSLOT_SIGNATURESLOT, cmsSignature);

    return buildSuperBlob(blobs);
  }

  // ── Pass 1: draft signature to learn blob size ──
  const origExecData = fileBuffer.subarray(slice.offset, slice.offset + codeLimit);
  const draftBlob = buildSignatureBlob(origExecData);

  // ── Stamp: update load-commands in a mutable copy ──
  const stamped = Buffer.from(fileBuffer);
  stampSignatureMetadata(stamped, slice, alignedOffset, draftBlob.length);

  // ── Pass 2: final signature with correct hashes ──
  const stampedExecData = stamped.subarray(slice.offset, slice.offset + codeLimit);
  let finalBlob = buildSignatureBlob(stampedExecData);

  // If the CMS DER encoding caused a size difference, re-stamp and rebuild
  if (finalBlob.length !== draftBlob.length) {
    stampSignatureMetadata(stamped, slice, alignedOffset, finalBlob.length);
    finalBlob = buildSignatureBlob(stamped.subarray(slice.offset, slice.offset + codeLimit));
  }

  // ── Assemble final binary (headers are already correct) ──
  return Buffer.concat([
    stamped.subarray(0, slice.offset + codeLimit),
    Buffer.alloc(paddingSize, 0),
    finalBlob,
    stamped.subarray(slice.offset + slice.size),
  ]);
}

// ─── Signature Metadata Helpers ─────────────────────────────────────

/**
 * Update LC_CODE_SIGNATURE and __LINKEDIT load-commands in place
 * so that the bytes in the hashed region are already final before
 * we compute code page hashes.
 */
function stampSignatureMetadata(
  buf: Buffer,
  slice: MachOSlice,
  signatureOffset: number,
  signatureSize: number,
): void {
  // LC_CODE_SIGNATURE: dataoff + datasize
  if (slice.codeSignature) {
    buf.writeUInt32LE(signatureOffset, slice.codeSignature.loadCommandOffset + 8);
    buf.writeUInt32LE(signatureSize, slice.codeSignature.loadCommandOffset + 12);
  }

  // __LINKEDIT: filesize + vmsize (page-aligned)
  const linkedit = findLinkeditSegment(slice, buf);
  if (linkedit) {
    const newFilesize = (signatureOffset + signatureSize) - linkedit.fileoff;
    const is64 = slice.header.is64;
    if (is64) {
      const pageSize = 0x4000; // 16 KiB for arm64
      const newVmsize = Math.ceil(newFilesize / pageSize) * pageSize;
      buf.writeBigUInt64LE(BigInt(newVmsize), linkedit.loadCommandOffset + 40);
      buf.writeBigUInt64LE(BigInt(newFilesize), linkedit.loadCommandOffset + 56);
    } else {
      const pageSize = 0x1000; // 4 KiB for arm32/x86
      const newVmsize = Math.ceil(newFilesize / pageSize) * pageSize;
      buf.writeUInt32LE(newVmsize, linkedit.loadCommandOffset + 28);
      buf.writeUInt32LE(newFilesize, linkedit.loadCommandOffset + 36);
    }
  }
}

/**
 * Assemble a new binary by replacing the slice's code signature region.
 * Does NOT touch load-commands — they must already be stamped.
 */
function assembleSignedBinary(
  stamped: Buffer,
  slice: MachOSlice,
  signatureBlob: Buffer,
): Buffer {
  const codeLimit = getExecutableSize(slice);
  const alignedOffset = Math.ceil(codeLimit / 16) * 16;
  const paddingSize = alignedOffset - codeLimit;

  return Buffer.concat([
    stamped.subarray(0, slice.offset + codeLimit),
    Buffer.alloc(paddingSize, 0),
    signatureBlob,
    stamped.subarray(slice.offset + slice.size),
  ]);
}

// rewriteBundleIdentifiers, findInfoPlists, and buildSigningEntitlements
// are imported from ./signing-utils (shared with signer.ts).

// ─── CodeResources (Resource Seal) ──────────────────────────────────

/**
 * Build the CodeResources XML plist that seals all files in the app bundle.
 * This is the _CodeSignature/CodeResources file.
 */
async function buildCodeResources(appPath: string, executableName?: string): Promise<string> {
  const files: Record<string, unknown> = {};
  const files2: Record<string, unknown> = {};
  const rules: Record<string, unknown> = {
    '^.*': true,
    '^.*\\.lproj/': { optional: true, weight: 1000 },
    '^.*\\.lproj/locversion.plist$': { omit: true, weight: 1100 },
    '^Base\\.lproj/': { weight: 1010 },
    '^version.plist$': true,
  };
  const rules2: Record<string, unknown> = {
    '.*\\.dSYM($|/)': { weight: 11, omit: true },
    '^(\\..*|Frameworks/[^/]+/(Versions/[^/]+/)?Resources/)': { weight: 20, omit: true },
    '^.*': true,
    '^.*\\.lproj/': { optional: true, weight: 1000 },
    '^.*\\.lproj/locversion.plist$': { omit: true, weight: 1100 },
    '^Base\\.lproj/': { weight: 1010 },
    '^Info\\.plist$': { omit: true, weight: 20 },
    '^PkgInfo$': { omit: true, weight: 20 },
    '^embedded\\.mobileprovision$': { weight: 20 },
    '^version\\.plist$': true,
    '^_CodeSignature/': { omit: true, weight: 20 },
    '^CodeResources$': { omit: true, weight: 20 },
  };

  // Walk all files in the app bundle
  const allFiles = await walkDir(appPath, appPath);

  for (const relativePath of allFiles) {
    // Skip _CodeSignature directory and CodeResources
    if (relativePath.startsWith('_CodeSignature/') || relativePath === 'CodeResources') continue;
    // Skip the main executable — it's signed separately via Mach-O embedding.
    // Including it here would cause a hash mismatch since signature embedding modifies it.
    if (executableName && relativePath === executableName) continue;

    const fullPath = path.join(appPath, relativePath);
    const fileData = await fs.readFile(fullPath);

    // SHA-1 hash for files
    const sha1 = crypto.createHash('sha1').update(fileData).digest('base64');

    // SHA-256 hash for files2
    const sha256 = crypto.createHash('sha256').update(fileData).digest('base64');

    // files: simple hash or omitted
    if (!relativePath.startsWith('_CodeSignature/')) {
      files[relativePath] = { hash: Buffer.from(sha1, 'base64') };
    }

    // files2: hash + hash2, with optional flag for .lproj
    const entry: Record<string, unknown> = {
      hash: Buffer.from(sha1, 'base64'),
      hash2: Buffer.from(sha256, 'base64'),
    };

    if (relativePath.includes('.lproj/')) {
      entry['optional'] = true;
    }

    files2[relativePath] = entry;
  }

  const resourceDict: Record<string, unknown> = {
    files,
    files2,
    rules,
    rules2,
  };

  return buildPlist(resourceDict);
}

/**
 * Recursively walk a directory and return relative paths of all files.
 */
async function walkDir(dir: string, baseDir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      results.push(...await walkDir(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push(relativePath);
    }
  }

  return results;
}

// ─── Nested Content Signing ─────────────────────────────────────────

/**
 * Sign all frameworks, dylibs, and app extensions inside the app bundle.
 */
async function signNestedContent(
  appPath: string,
  params: SigningParams,
): Promise<void> {
  // Sign Frameworks
  const frameworksDir = path.join(appPath, 'Frameworks');
  try {
    const items = await fs.readdir(frameworksDir);
    for (const item of items) {
      const itemPath = path.join(frameworksDir, item);
      const stat = await fs.stat(itemPath);

      if (item.endsWith('.framework') && stat.isDirectory()) {
        await signFramework(itemPath, params);
      } else if (item.endsWith('.dylib') && stat.isFile()) {
        await signDylib(itemPath, params);
      }
    }
  } catch {
    // No Frameworks directory — normal for simple apps
  }

  // Sign PlugIns (app extensions) with per-extension profiles
  const pluginsDir = path.join(appPath, 'PlugIns');
  try {
    const plugins = await fs.readdir(pluginsDir);
    for (const plugin of plugins) {
      if (plugin.endsWith('.appex')) {
        const pluginPath = path.join(pluginsDir, plugin);
        await signAppExtension(pluginPath, params);
      }
    }
  } catch {
    // No PlugIns directory
  }
}

/**
 * Sign a .framework bundle.
 * Generates fresh CodeResources and includes its hash in the CodeDirectory.
 */
async function signFramework(frameworkPath: string, params: SigningParams): Promise<void> {
  // Find the main binary (same name as framework minus .framework)
  const fwName = path.basename(frameworkPath, '.framework');
  const binaryPath = path.join(frameworkPath, fwName);

  if (!existsSync(binaryPath)) return;

  let resultBuffer: Buffer = await fs.readFile(binaryPath) as Buffer;

  // Attempt to parse as Mach-O — resource-only frameworks have no binary
  let macho;
  try {
    macho = parseMachO(resultBuffer);
  } catch {
    signerLog.info(`Framework ${fwName}: not Mach-O, skipping`);
    return;
  }

  // Build CodeResources BEFORE signing the binary.
  // CodeResources hashes all files except the binary and _CodeSignature/.
  const codeResourcesXml = await buildCodeResources(frameworkPath, fwName);
  const csDir = path.join(frameworkPath, '_CodeSignature');
  await fs.mkdir(csDir, { recursive: true });
  await fs.writeFile(path.join(csDir, 'CodeResources'), codeResourcesXml, 'utf8');

  // Build special slot hashes for the framework's CodeDirectory
  const requirementsBlob = buildEmptyRequirements();
  const specialHashes = new Map<number, Buffer>();
  specialHashes.set(CSSLOT_REQUIREMENTS,
    computeSpecialSlotHash(requirementsBlob, CS_HASHTYPE_SHA256));
  specialHashes.set(CSSLOT_RESOURCEDIR,
    computeSpecialSlotHash(Buffer.from(codeResourcesXml, 'utf8'), CS_HASHTYPE_SHA256));

  // Include Info.plist hash if the framework has one
  const fwInfoPlistPath = path.join(frameworkPath, 'Info.plist');
  if (existsSync(fwInfoPlistPath)) {
    const fwInfoData = await fs.readFile(fwInfoPlistPath);
    specialHashes.set(CSSLOT_INFOSLOT,
      computeSpecialSlotHash(fwInfoData, CS_HASHTYPE_SHA256));
  }

  // Sign each slice (two-pass: stamp headers first, then hash and build signature)
  for (let i = 0; i < macho.slices.length; i++) {
    const currentMacho = i === 0 ? macho : parseMachO(resultBuffer);
    const slice = currentMacho.slices[i];
    const codeLimit = getExecutableSize(slice);
    const alignedOffset = Math.ceil(codeLimit / 16) * 16;

    // Helper: build signature blob from executable data
    function buildFwBlob(execData: Buffer): Buffer {
      const hashes = computeCodeHashes(execData, CS_PAGE_SIZE, CS_HASHTYPE_SHA256);
      const codeDir = buildCodeDirectory({
        identifier: fwName,
        teamId: params.teamId,
        hashType: CS_HASHTYPE_SHA256,
        codeLimit,
        pageSize: CS_PAGE_SIZE,
        codeHashes: hashes,
        specialHashes,
        flags: 0,
      });
      const cms = createCMSSignature(codeDir, params.certificatePem, params.privateKeyPem);
      const blobs = new Map<number, Buffer>();
      blobs.set(CSSLOT_CODEDIRECTORY, codeDir);
      blobs.set(CSSLOT_REQUIREMENTS, requirementsBlob);
      blobs.set(CSSLOT_SIGNATURESLOT, cms);
      return buildSuperBlob(blobs);
    }

    // Pass 1: draft to learn blob size
    const origExecData = resultBuffer.subarray(slice.offset, slice.offset + codeLimit);
    const draftBlob = buildFwBlob(origExecData);

    // Stamp headers in mutable buffer
    const stamped = Buffer.from(resultBuffer);
    stampSignatureMetadata(stamped, slice, alignedOffset, draftBlob.length);

    // Pass 2: final signature with correct hashes
    let finalBlob = buildFwBlob(stamped.subarray(slice.offset, slice.offset + codeLimit));
    if (finalBlob.length !== draftBlob.length) {
      stampSignatureMetadata(stamped, slice, alignedOffset, finalBlob.length);
      finalBlob = buildFwBlob(stamped.subarray(slice.offset, slice.offset + codeLimit));
    }

    resultBuffer = assembleSignedBinary(stamped, slice, finalBlob);
  }

  await fs.writeFile(binaryPath, resultBuffer);
}

/**
 * Sign a standalone .dylib file.
 */
async function signDylib(dylibPath: string, params: SigningParams): Promise<void> {
  let resultBuffer: Buffer = await fs.readFile(dylibPath) as Buffer;
  const name = path.basename(dylibPath);

  // Attempt to parse as Mach-O — skip if not a valid binary
  let macho;
  try {
    macho = parseMachO(resultBuffer);
  } catch {
    signerLog.info(`Dylib ${name}: not Mach-O, skipping`);
    return;
  }

  const requirementsBlob = buildEmptyRequirements();
  const specialHashes = new Map<number, Buffer>();
  specialHashes.set(CSSLOT_REQUIREMENTS,
    computeSpecialSlotHash(requirementsBlob, CS_HASHTYPE_SHA256));

  // Sign each slice (two-pass: stamp headers first, then hash and build signature)
  for (let i = 0; i < macho.slices.length; i++) {
    const currentMacho = i === 0 ? macho : parseMachO(resultBuffer);
    const slice = currentMacho.slices[i];
    const codeLimit = getExecutableSize(slice);
    const alignedOffset = Math.ceil(codeLimit / 16) * 16;

    function buildDylibBlob(execData: Buffer): Buffer {
      const hashes = computeCodeHashes(execData, CS_PAGE_SIZE, CS_HASHTYPE_SHA256);
      const codeDir = buildCodeDirectory({
        identifier: name,
        teamId: params.teamId,
        hashType: CS_HASHTYPE_SHA256,
        codeLimit,
        pageSize: CS_PAGE_SIZE,
        codeHashes: hashes,
        specialHashes,
        flags: 0,
      });
      const cms = createCMSSignature(codeDir, params.certificatePem, params.privateKeyPem);
      const blobs = new Map<number, Buffer>();
      blobs.set(CSSLOT_CODEDIRECTORY, codeDir);
      blobs.set(CSSLOT_REQUIREMENTS, requirementsBlob);
      blobs.set(CSSLOT_SIGNATURESLOT, cms);
      return buildSuperBlob(blobs);
    }

    // Pass 1: draft to learn blob size
    const origExecData = resultBuffer.subarray(slice.offset, slice.offset + codeLimit);
    const draftBlob = buildDylibBlob(origExecData);

    // Stamp headers in mutable buffer
    const stamped = Buffer.from(resultBuffer);
    stampSignatureMetadata(stamped, slice, alignedOffset, draftBlob.length);

    // Pass 2: final signature with correct hashes
    let finalBlob = buildDylibBlob(stamped.subarray(slice.offset, slice.offset + codeLimit));
    if (finalBlob.length !== draftBlob.length) {
      stampSignatureMetadata(stamped, slice, alignedOffset, finalBlob.length);
      finalBlob = buildDylibBlob(stamped.subarray(slice.offset, slice.offset + codeLimit));
    }

    resultBuffer = assembleSignedBinary(stamped, slice, finalBlob);
  }

  await fs.writeFile(dylibPath, resultBuffer);
}

/**
 * Sign an .appex (app extension) bundle with its own profile and entitlements.
 */
async function signAppExtension(
  appexPath: string,
  params: SigningParams,
): Promise<void> {
  // Read the extension's Info.plist
  const infoPlist = await parsePlistFile(path.join(appexPath, 'Info.plist'));
  const execName = String(infoPlist['CFBundleExecutable'] || '');
  if (!execName) return;

  const execPath = path.join(appexPath, execName);
  if (!existsSync(execPath)) return;

  // Get the extension's (already rewritten) bundle ID
  const extBundleId = String(infoPlist['CFBundleIdentifier'] || '');

  // Find the matching extension profile, or fall back to main profile
  const profileEntry = params.extensionProfiles?.find(ep => ep.bundleId === extBundleId);
  const profileData = profileEntry?.profileData ?? params.provisioningProfileData;

  // Embed provisioning profile in the extension
  await fs.writeFile(path.join(appexPath, 'embedded.mobileprovision'), profileData);

  // Build extension-specific entitlements
  const profilePlist = parseMobileProvision(profileData);
  const profileEntitlements = (profilePlist['Entitlements'] || {}) as Record<string, unknown>;
  const extEntitlements = buildSigningEntitlements(profileEntitlements, params.teamId, extBundleId);
  const extEntitlementsPlistXml = buildPlist(extEntitlements);

  // Sign frameworks inside the extension
  const fwDir = path.join(appexPath, 'Frameworks');
  try {
    const items = await fs.readdir(fwDir);
    for (const item of items) {
      const itemPath = path.join(fwDir, item);
      const stat = await fs.stat(itemPath);
      if (item.endsWith('.framework') && stat.isDirectory()) {
        await signFramework(itemPath, params);
      } else if (item.endsWith('.dylib') && stat.isFile()) {
        await signDylib(itemPath, params);
      }
    }
  } catch { /* no frameworks */ }

  // Build CodeResources for the extension
  const codeResourcesXml = await buildCodeResources(appexPath, execName);
  const csDir = path.join(appexPath, '_CodeSignature');
  await fs.mkdir(csDir, { recursive: true });
  await fs.writeFile(path.join(csDir, 'CodeResources'), codeResourcesXml, 'utf8');

  // Read the extension's Info.plist bytes for the special slot 1 hash
  const extInfoPlistData = await fs.readFile(path.join(appexPath, 'Info.plist'));

  // Sign with extension-specific bundle ID and entitlements
  const extParams: SigningParams = {
    ...params,
    targetBundleId: extBundleId,
    infoPlistData: extInfoPlistData,
  };
  await signMachOBinary(execPath, extParams, extEntitlementsPlistXml, codeResourcesXml);
}

// ─── IPA Repacking ──────────────────────────────────────────────────

/**
 * Repack a directory into a ZIP/IPA file using adm-zip.
 * Cross-platform replacement for `zip -qry`.
 */
async function repackIpa(unpackDir: string, outputPath: string): Promise<void> {
  const zip = new AdmZip();
  const payloadDir = path.join(unpackDir, 'Payload');

  // Mach-O magic numbers used to detect executables for permission preservation
  const MACHO_MAGICS = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

  // Add Payload/ directory
  const files = await walkDir(payloadDir, unpackDir);
  for (const relativePath of files) {
    const fullPath = path.join(unpackDir, relativePath);
    const data = await fs.readFile(fullPath);
    zip.addFile(relativePath, data);

    // Preserve Unix executable permissions for Mach-O binaries.
    // Without this, iOS rejects executables with 0644 permissions.
    if (data.length >= 4) {
      const magic = data.readUInt32LE(0);
      if (MACHO_MAGICS.has(magic)) {
        const entry = zip.getEntry(relativePath);
        if (entry) {
          // Set Unix mode 0755 in the external attributes (upper 16 bits)
          entry.header.attr = (0o100755 << 16) >>> 0;
        }
      }
    }
  }

  zip.writeZip(outputPath);
}
