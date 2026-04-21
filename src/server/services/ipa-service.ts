// ─── IPA Service ────────────────────────────────────────────────────
// Handles IPA upload, parsing, metadata extraction, and storage.

import path from 'node:path';
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { v4 as uuid } from 'uuid';
import { parsePlistBuffer, parseMobileProvision } from '../utils/plist';
import type { IpaArtifact } from '../../shared/types';
import type { Database } from '../state/database';

export class IpaService {
  constructor(
    private db: Database,
    private uploadDir: string,
  ) {}

  /**
   * Process an uploaded IPA file: parse metadata, store in DB.
   */
  async processUpload(
    filePath: string,
    originalName: string,
  ): Promise<IpaArtifact> {
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      throw new Error('Invalid IPA: uploaded file is empty');
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(filePath);
    } catch (err) {
      throw new Error(
        `Invalid IPA: not a valid zip archive (${(err as Error).message}). ` +
        `IPAs are renamed zip files — verify the upload is not corrupted.`,
      );
    }

    const entries = zip.getEntries();
    if (entries.length === 0) {
      throw new Error('Invalid IPA: zip archive is empty');
    }

    // Case-insensitive match so we accept IPAs packaged on case-sensitive hosts.
    const infoPlistRe = /^Payload\/[^/]+\.app\/Info\.plist$/i;
    const appEntry = entries.find((e) =>
      infoPlistRe.test(e.entryName) && !e.isDirectory,
    );

    if (!appEntry) {
      const topLevel = new Set<string>();
      for (const e of entries) {
        const firstSeg = e.entryName.split(/[\\/]/, 1)[0];
        if (firstSeg) topLevel.add(firstSeg);
      }
      const sample = entries.slice(0, 20).map((e) => e.entryName).join(', ');
      const moreNote = entries.length > 20 ? ` (+${entries.length - 20} more)` : '';
      throw new Error(
        'Invalid IPA: no Info.plist found matching Payload/*.app/. ' +
        `Top-level entries: [${[...topLevel].join(', ') || '(none)'}]. ` +
        `First entries: [${sample}]${moreNote}. ` +
        'Expected structure: Payload/<AppName>.app/Info.plist. ' +
        'Common causes: zipped Xcode archive (.xcarchive), a zipped .app bundle ' +
        'without the Payload wrapper, or a corrupted download.',
      );
    }

    let infoPlist: Record<string, unknown>;
    try {
      infoPlist = parsePlistBuffer(appEntry.getData());
    } catch (err) {
      throw new Error(
        `Invalid IPA: could not parse Info.plist (${(err as Error).message}). ` +
        `Entry: ${appEntry.entryName}, size: ${appEntry.header.size} bytes.`,
      );
    }

    // Extract embedded provisioning profile entitlements
    let entitlements: Record<string, unknown> = {};
    const provisionEntry = entries.find(e =>
      /^Payload\/[^/]+\.app\/embedded\.mobileprovision$/.test(e.entryName),
    );
    if (provisionEntry) {
      try {
        const provPlist = parseMobileProvision(provisionEntry.getData());
        entitlements = (provPlist['Entitlements'] || {}) as Record<string, unknown>;
      } catch (err) {
        // Provisioning profile may be missing or invalid — log it for diagnostics
        console.warn('[ipa-service] Failed to parse embedded provisioning profile:', (err as Error).message);
      }
    }

    // Extract app icon (best effort)
    let iconData: string | null = null;
    const iconNames = [
      'AppIcon60x60@3x.png', 'AppIcon60x60@2x.png',
      'AppIcon76x76@2x.png', 'AppIcon.png',
      'Icon-60@3x.png', 'Icon-60@2x.png',
    ];
    for (const iconName of iconNames) {
      const iconEntry = entries.find(e =>
        e.entryName.endsWith(iconName) && !e.isDirectory,
      );
      if (iconEntry) {
        iconData = iconEntry.getData().toString('base64');
        break;
      }
    }

    // Build warnings
    const warnings: string[] = [];
    const bundleId = String(infoPlist['CFBundleIdentifier'] || '');
    if (!bundleId) warnings.push('Missing CFBundleIdentifier');
    if (!infoPlist['CFBundleDisplayName'] && !infoPlist['CFBundleName']) {
      warnings.push('Missing app display name');
    }

    const minOs = String(infoPlist['MinimumOSVersion'] || '');
    if (minOs) {
      const major = parseInt(minOs.split('.')[0] || '0');
      if (major < 14) warnings.push(`Target iOS ${minOs} — may have compatibility issues`);
    }

    // Scan for app extensions (PlugIns/*.appex)
    const extensions: Array<{ bundleId: string; name: string }> = [];
    for (const entry of entries) {
      if (/^Payload\/[^/]+\.app\/PlugIns\/[^/]+\.appex\/Info\.plist$/.test(entry.entryName) && !entry.isDirectory) {
        try {
          const extPlist = parsePlistBuffer(entry.getData());
          const extBundleId = String(extPlist['CFBundleIdentifier'] || '');
          const extName = String(
            extPlist['CFBundleDisplayName'] || extPlist['CFBundleName'] || '',
          );
          if (extBundleId) {
            extensions.push({ bundleId: extBundleId, name: extName || extBundleId.split('.').pop() || 'Extension' });
          }
        } catch { /* skip unparseable extension */ }
      }
    }

    const ipa: IpaArtifact = {
      id: uuid(),
      filename: path.basename(filePath),
      originalName,
      filePath,
      fileSize: stat.size,
      bundleId,
      bundleName: String(infoPlist['CFBundleDisplayName'] || infoPlist['CFBundleName'] || 'Unknown'),
      bundleVersion: String(infoPlist['CFBundleVersion'] || '1'),
      bundleShortVersion: String(infoPlist['CFBundleShortVersionString'] || '1.0'),
      minOsVersion: minOs || null,
      iconData,
      entitlements,
      warnings,
      extensions,
      uploadedAt: new Date().toISOString(),
    };

    this.db.saveIpa(ipa);

    // Attach previous version diff info when re-importing same bundleId
    const existing = this.db.listIpas().find(e => e.bundleId === ipa.bundleId && e.id !== ipa.id);
    if (existing) {
      ipa.previousVersion = {
        id: existing.id,
        version: existing.bundleShortVersion,
        fileSize: existing.fileSize,
      };
    }

    return ipa;
  }

  /**
   * Get an IPA by ID.
   */
  get(id: string): IpaArtifact | null {
    return this.db.getIpa(id);
  }

  /**
   * List all uploaded IPAs.
   */
  list(): IpaArtifact[] {
    return this.db.listIpas();
  }

  /**
   * Delete an IPA.
   */
  async delete(id: string): Promise<void> {
    const ipa = this.db.getIpa(id);
    if (ipa) {
      // Remove signed output files linked to installs of this IPA.
      const relatedInstalls = this.db.listInstalledApps().filter((entry) => entry.ipaId === id);
      const signedPaths = new Set(relatedInstalls.map((entry) => entry.signedIpaPath).filter(Boolean));
      for (const signedPath of signedPaths) {
        await fs.unlink(signedPath).catch(() => {});
      }

      await fs.unlink(ipa.filePath).catch(() => {});
      this.db.deleteIpa(id);
    }
  }
}
