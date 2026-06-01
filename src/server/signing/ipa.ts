// ─── IPA Packaging ──────────────────────────────────────────────────
// Extract and repackage IPA files (which are ZIP archives) using the
// pure-JS `adm-zip` library.
//
// This keeps signing fully cross-platform: no system `unzip`/`zip`
// (absent on Windows) and no `ditto` (macOS-only). It also removes the
// subprocess failure modes of the old shell-out path — most notably the
// 60s timeout/hang seen when `unzip` blocked on an interactive overwrite
// prompt or when a slow volume exceeded the spawn timeout.
//
// iOS .app bundles are flat (no internal symlinks) and the code signature
// is content-based — stored in the Mach-O and _CodeSignature/CodeResources
// — so archive tool choice does not affect signature validity. installd
// re-applies file permissions on the device at install time.

import fs from 'node:fs';
import AdmZip from 'adm-zip';
import { SigningError } from '../utils/errors';

/**
 * Extract an IPA file to a directory.
 * IPAs are ZIP archives. Original unix permissions are preserved so the
 * extracted Mach-O binaries stay executable for the signing step.
 */
export async function extractIpa(ipaPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });

  try {
    const zip = new AdmZip(ipaPath);
    zip.extractAllTo(destDir, /* overwrite */ true, /* keepOriginalPermission */ true);
  } catch (err) {
    throw new SigningError('EXTRACT_FAILED', `Failed to extract IPA: ${(err as Error).message}`);
  }
}

/**
 * Repackage a directory into an IPA file. Rebuilds the archive from the
 * directory's contents, so `Payload/<App>.app/...` lands at the archive
 * root exactly as iOS expects.
 */
export async function packageIpa(srcDir: string, ipaPath: string): Promise<void> {
  // Remove existing output if present.
  if (fs.existsSync(ipaPath)) {
    fs.rmSync(ipaPath);
  }

  try {
    const zip = new AdmZip();
    zip.addLocalFolder(srcDir);
    zip.writeZip(ipaPath);
  } catch (err) {
    throw new SigningError('PACKAGE_FAILED', `Failed to package IPA: ${(err as Error).message}`);
  }
}

/**
 * List the entry names inside an IPA, for inspection/debugging.
 */
export async function inspectIpaStructure(ipaPath: string): Promise<string[]> {
  try {
    const zip = new AdmZip(ipaPath);
    return zip
      .getEntries()
      .map((entry) => entry.entryName)
      .filter((name) => name.length > 0);
  } catch (err) {
    throw new SigningError('INSPECT_FAILED', `Failed to inspect IPA: ${(err as Error).message}`);
  }
}

/**
 * Get the .app directory name inside an extracted IPA's Payload directory.
 */
export function getAppName(payloadDir: string): string {
  if (!fs.existsSync(payloadDir)) {
    throw new SigningError('NO_PAYLOAD', 'No Payload directory found');
  }

  const entries = fs.readdirSync(payloadDir).filter((e) => e.endsWith('.app'));
  if (entries.length === 0) {
    throw new SigningError('NO_APP', 'No .app directory found in Payload');
  }

  return entries[0];
}
