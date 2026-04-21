// ─── IPA Service Tests ──────────────────────────────────────────────
// Focused on error messaging for invalid uploads — the user-visible
// "Invalid IPA: no Info.plist…" error used to omit the diagnostic data
// needed to understand why a given file failed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';

import { IpaService } from '../src/server/services/ipa-service';
import type { Database } from '../src/server/state/database';

function makeStubDb(): Database {
  const ipas: Record<string, any> = {};
  return {
    saveIpa: (ipa: any) => { ipas[ipa.id] = ipa; },
    listIpas: () => Object.values(ipas),
    getIpa: (id: string) => ipas[id] ?? null,
    listInstalledApps: () => [],
    deleteIpa: (id: string) => { delete ipas[id]; },
  } as unknown as Database;
}

describe('IpaService.processUpload diagnostics', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidelink-ipa-test-'));
  });

  afterAll(async () => {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('throws a diagnostic error when the archive has no Payload/*.app/Info.plist', async () => {
    // Build a zip that looks like an .xcarchive (no Payload dir).
    const zip = new AdmZip();
    zip.addFile('SomeApp.xcarchive/Info.plist', Buffer.from('<?xml?>'));
    zip.addFile('SomeApp.xcarchive/dSYMs/SomeApp.dSYM/Contents/Info.plist', Buffer.from('<?xml?>'));
    const zipPath = path.join(tmpDir, 'archive.ipa');
    zip.writeZip(zipPath);

    const svc = new IpaService(makeStubDb(), tmpDir);
    await expect(svc.processUpload(zipPath, 'archive.ipa')).rejects.toThrow(/Payload\/\*\.app\//);
    await expect(svc.processUpload(zipPath, 'archive.ipa')).rejects.toThrow(/SomeApp\.xcarchive/);
  });

  it('throws a clear error on an empty file', async () => {
    const emptyPath = path.join(tmpDir, 'empty.ipa');
    await fs.writeFile(emptyPath, Buffer.alloc(0));
    const svc = new IpaService(makeStubDb(), tmpDir);
    await expect(svc.processUpload(emptyPath, 'empty.ipa')).rejects.toThrow(/empty/i);
  });

  it('throws a clear error on a non-zip file', async () => {
    const bogusPath = path.join(tmpDir, 'bogus.ipa');
    await fs.writeFile(bogusPath, Buffer.from('not a zip file at all'));
    const svc = new IpaService(makeStubDb(), tmpDir);
    await expect(svc.processUpload(bogusPath, 'bogus.ipa')).rejects.toThrow(/zip/i);
  });

  it('accepts a minimal valid IPA and extracts Info.plist', async () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.example.TestApp</string>
  <key>CFBundleDisplayName</key><string>Test App</string>
  <key>CFBundleName</key><string>TestApp</string>
  <key>CFBundleShortVersionString</key><string>1.2.3</string>
  <key>CFBundleVersion</key><string>42</string>
  <key>MinimumOSVersion</key><string>15.0</string>
</dict></plist>`;
    const zip = new AdmZip();
    zip.addFile('Payload/TestApp.app/Info.plist', Buffer.from(plist, 'utf8'));
    const zipPath = path.join(tmpDir, 'minimal.ipa');
    zip.writeZip(zipPath);

    const svc = new IpaService(makeStubDb(), tmpDir);
    const result = await svc.processUpload(zipPath, 'minimal.ipa');
    expect(result.bundleId).toBe('com.example.TestApp');
    expect(result.bundleName).toBe('Test App');
    expect(result.bundleShortVersion).toBe('1.2.3');
  });

  it('matches Info.plist path case-insensitively (tolerant of casing variations)', async () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.example.LowerApp</string>
  <key>CFBundleName</key><string>lower</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
</dict></plist>`;
    const zip = new AdmZip();
    // "payload" lowercased — should still match.
    zip.addFile('payload/LowerApp.app/Info.plist', Buffer.from(plist, 'utf8'));
    const zipPath = path.join(tmpDir, 'lower.ipa');
    zip.writeZip(zipPath);

    const svc = new IpaService(makeStubDb(), tmpDir);
    const result = await svc.processUpload(zipPath, 'lower.ipa');
    expect(result.bundleId).toBe('com.example.LowerApp');
  });
});
