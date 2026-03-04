import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import plist from 'plist';

export interface SampleIpaOptions {
  bundleId?: string;
  displayName?: string;
  version?: string;
  includeEntitlements?: boolean;
}

export const createSampleIpa = async (options: SampleIpaOptions = {}): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-test-'));
  const ipaPath = path.join(tempDir, 'Sample.ipa');

  const zip = new AdmZip();

  const infoPlist = plist.build({
    CFBundleIdentifier: options.bundleId ?? 'com.demo.sample',
    CFBundleDisplayName: options.displayName ?? 'Sample App',
    CFBundleShortVersionString: options.version ?? '1.2.3',
    MinimumOSVersion: '16.0'
  });

  zip.addFile('Payload/Sample.app/Info.plist', Buffer.from(infoPlist, 'utf8'));

  if (options.includeEntitlements !== false) {
    const xcent = plist.build({
      'application-identifier': 'TEAMID.com.demo.sample',
      'com.apple.developer.team-identifier': 'TEAMID',
      'get-task-allow': false
    });

    const embedded = plist.build({
      Entitlements: {
        'aps-environment': 'development',
        'com.apple.security.application-groups': ['group.com.demo.shared']
      }
    });

    const provision = Buffer.from(`\nFAKECMSHEADER\n${embedded}\nFAKECMSFOOTER\n`, 'utf8');
    zip.addFile('Payload/Sample.app/archived-expanded-entitlements.xcent', Buffer.from(xcent, 'utf8'));
    zip.addFile('Payload/Sample.app/embedded.mobileprovision', provision);
  }

  await writeFile(ipaPath, zip.toBuffer());
  return ipaPath;
};
