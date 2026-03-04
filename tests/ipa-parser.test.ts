import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { describe, expect, test } from 'vitest';
import { IpaService } from '../src/server/services/ipa-service';
import { LogService } from '../src/server/services/log-service';
import { AppStore } from '../src/server/state/store';
import { createSampleIpa } from './helpers';

describe('IpaService parsing', () => {
  test('extracts metadata and entitlement capabilities', async () => {
    const ipaPath = await createSampleIpa();
    const data = await readFile(ipaPath);

    const store = new AppStore('demo');
    const logs = new LogService(store);
    const service = new IpaService(store, logs);

    const item = await service.inspectAndStore({
      path: ipaPath,
      filename: path.basename(ipaPath),
      originalname: 'Sample.ipa',
      size: data.byteLength
    });

    expect(item.bundleId).toBe('com.demo.sample');
    expect(item.displayName).toBe('Sample App');
    expect(item.version).toBe('1.2.3');
    expect(item.entitlements['aps-environment']).toBe('development');
    expect(item.capabilities).toContain('aps-environment');
    expect(item.capabilities).toContain('com.apple.security.application-groups');
    expect(service.list().length).toBe(1);
    expect(existsSync(ipaPath)).toBe(true);

    store.close();
  });

  test('removes rejected upload artifacts when archive is invalid', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-invalid-ipa-'));
    const ipaPath = path.join(tempDir, 'Broken.ipa');
    await writeFile(ipaPath, Buffer.from('not-a-zip-archive', 'utf8'));

    const store = new AppStore('demo');
    const logs = new LogService(store);
    const service = new IpaService(store, logs);

    await expect(
      service.inspectAndStore({
        path: ipaPath,
        filename: path.basename(ipaPath),
        originalname: 'Broken.ipa',
        size: Buffer.byteLength('not-a-zip-archive', 'utf8')
      })
    ).rejects.toMatchObject({
      code: 'INVALID_IPA_ARCHIVE'
    });

    expect(existsSync(ipaPath)).toBe(false);

    store.close();
  });

  test('removes rejected upload artifacts when Info.plist is missing', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-missing-info-ipa-'));
    const ipaPath = path.join(tempDir, 'MissingInfo.ipa');

    const zip = new AdmZip();
    zip.addFile('Payload/Sample.app/README.txt', Buffer.from('hello', 'utf8'));
    await writeFile(ipaPath, zip.toBuffer());

    const data = await readFile(ipaPath);

    const store = new AppStore('demo');
    const logs = new LogService(store);
    const service = new IpaService(store, logs);

    await expect(
      service.inspectAndStore({
        path: ipaPath,
        filename: path.basename(ipaPath),
        originalname: 'MissingInfo.ipa',
        size: data.byteLength
      })
    ).rejects.toMatchObject({
      code: 'INFO_PLIST_NOT_FOUND'
    });

    expect(existsSync(ipaPath)).toBe(false);

    store.close();
  });
});
