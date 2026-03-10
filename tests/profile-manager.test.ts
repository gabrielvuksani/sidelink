import { describe, expect, it, vi } from 'vitest';
import plist from 'plist';
import forge from 'node-forge';

import { ProfileManager } from '../src/server/services/profile-manager';

function createCertificatePem(commonName: string): string {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2024-01-01T00:00:00.000Z');
  cert.validity.notAfter = new Date('2027-01-01T00:00:00.000Z');
  cert.setSubject([{ name: 'commonName', value: commonName }]);
  cert.setIssuer([{ name: 'commonName', value: commonName }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

function createEncodedProfile(options: {
  teamId: string;
  bundleId: string;
  deviceUdid: string;
  certificatePem: string;
  expirationDate?: string;
}): string {
  const cert = forge.pki.certificateFromPem(options.certificatePem);
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  const xml = plist.build({
    AppIDName: options.bundleId,
    ApplicationIdentifierPrefix: [options.teamId],
    CreationDate: new Date('2025-01-01T00:00:00.000Z'),
    DeveloperCertificates: [der],
    Entitlements: {
      'application-identifier': `${options.teamId}.${options.bundleId}`,
      'com.apple.developer.team-identifier': options.teamId,
      'get-task-allow': true,
    },
    ExpirationDate: options.expirationDate ?? '2026-12-31T00:00:00.000Z',
    Name: `iOS Team Provisioning Profile: ${options.bundleId}`,
    ProvisionedDevices: [options.deviceUdid],
    TeamIdentifier: [options.teamId],
    UUID: 'TEST-PROFILE-UUID',
  });
  return Buffer.from(xml, 'utf8').toString('base64');
}

describe('ProfileManager', () => {
  it('reuses a cached profile when it matches the current certificate and device', async () => {
    const certificatePem = createCertificatePem('Matching Cert');
    const encodedProfile = createEncodedProfile({
      teamId: 'TEAM123',
      bundleId: 'com.sidelink.demo',
      deviceUdid: 'device-1',
      certificatePem,
    });

    const existingProfile = {
      id: 'profile-1',
      accountId: 'account-1',
      teamId: 'TEAM123',
      portalProfileId: 'portal-profile-1',
      appIdId: 'app-id-1',
      bundleId: 'com.sidelink.demo',
      profileData: encodedProfile,
      expiresAt: '2026-12-31T00:00:00.000Z',
      createdAt: '2025-01-03T00:00:00.000Z',
    };

    const db = {
      getActiveProfile: vi.fn(() => existingProfile),
      saveProfile: vi.fn(),
    } as any;
    const client = {
      deleteProvisioningProfile: vi.fn(),
      downloadProvisioningProfile: vi.fn(),
    } as any;

    const manager = new ProfileManager(db);
    const result = await manager.ensureProfile(
      client,
      'account-1',
      'TEAM123',
      {
        id: 'app-id-1',
        accountId: 'account-1',
        teamId: 'TEAM123',
        portalAppIdId: 'portal-app-1',
        bundleId: 'com.sidelink.demo',
        name: 'Demo',
        originalBundleId: 'com.original.demo',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'cert-1',
        accountId: 'account-1',
        teamId: 'TEAM123',
        serialNumber: '1',
        commonName: 'Matching Cert',
        certificatePem,
        privateKeyPem: 'private-key',
        portalCertificateId: 'portal-cert-1',
        expiresAt: '2026-12-31T00:00:00.000Z',
        revokedAt: null,
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'device-reg-1',
        accountId: 'account-1',
        teamId: 'TEAM123',
        udid: 'device-1',
        portalDeviceId: 'portal-device-1',
        deviceName: 'Phone',
        registeredAt: '2025-01-01T00:00:00.000Z',
      },
    );

    expect(result).toBe(existingProfile);
    expect(client.downloadProvisioningProfile).not.toHaveBeenCalled();
    expect(db.saveProfile).not.toHaveBeenCalled();
  });

  it('regenerates the profile when the cached profile does not include the active certificate', async () => {
    const staleCertificatePem = createCertificatePem('Stale Cert');
    const activeCertificatePem = createCertificatePem('Active Cert');
    const staleProfile = createEncodedProfile({
      teamId: 'TEAM123',
      bundleId: 'com.sidelink.demo',
      deviceUdid: 'device-1',
      certificatePem: staleCertificatePem,
    });
    const freshProfile = createEncodedProfile({
      teamId: 'TEAM123',
      bundleId: 'com.sidelink.demo',
      deviceUdid: 'device-1',
      certificatePem: activeCertificatePem,
    });

    const db = {
      getActiveProfile: vi.fn(() => ({
        id: 'profile-1',
        accountId: 'account-1',
        teamId: 'TEAM123',
        portalProfileId: 'portal-profile-1',
        appIdId: 'app-id-1',
        bundleId: 'com.sidelink.demo',
        profileData: staleProfile,
        expiresAt: '2026-12-31T00:00:00.000Z',
        createdAt: '2025-01-03T00:00:00.000Z',
      })),
      saveProfile: vi.fn(),
    } as any;
    const client = {
      deleteProvisioningProfile: vi.fn(async () => {}),
      downloadProvisioningProfile: vi.fn(async () => ({
        provisioningProfileId: 'portal-profile-2',
        encodedProfile: freshProfile,
        expirationDate: '2026-12-31T00:00:00.000Z',
      })),
    } as any;

    const manager = new ProfileManager(db);
    const result = await manager.ensureProfile(
      client,
      'account-1',
      'TEAM123',
      {
        id: 'app-id-1',
        accountId: 'account-1',
        teamId: 'TEAM123',
        portalAppIdId: 'portal-app-1',
        bundleId: 'com.sidelink.demo',
        name: 'Demo',
        originalBundleId: 'com.original.demo',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'cert-1',
        accountId: 'account-1',
        teamId: 'TEAM123',
        serialNumber: '1',
        commonName: 'Active Cert',
        certificatePem: activeCertificatePem,
        privateKeyPem: 'private-key',
        portalCertificateId: 'portal-cert-1',
        expiresAt: '2026-12-31T00:00:00.000Z',
        revokedAt: null,
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'device-reg-1',
        accountId: 'account-1',
        teamId: 'TEAM123',
        udid: 'device-1',
        portalDeviceId: 'portal-device-1',
        deviceName: 'Phone',
        registeredAt: '2025-01-01T00:00:00.000Z',
      },
    );

    expect(client.deleteProvisioningProfile).toHaveBeenCalledWith('TEAM123', 'portal-profile-1');
    expect(client.downloadProvisioningProfile).toHaveBeenCalledWith('TEAM123', 'portal-app-1');
    expect(db.saveProfile).toHaveBeenCalledTimes(1);
    expect(result.portalProfileId).toBe('portal-profile-2');
  });
});