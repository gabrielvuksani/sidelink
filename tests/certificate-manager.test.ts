import { describe, expect, it, vi } from 'vitest';
import forge from 'node-forge';

import { CertificateManager } from '../src/server/apple/certificate-manager';
import type { AppleCertificate } from '../src/server/apple/developer-services';

// ─── Helpers ────────────────────────────────────────────────────────

/** Build a base64-encoded DER cert that derToPem can decode round-trip. */
function makeDerCertBase64(commonName: string): string {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2024-01-01T00:00:00.000Z');
  cert.validity.notAfter = new Date('2027-01-01T00:00:00.000Z');
  cert.setSubject([{ name: 'commonName', value: commonName }]);
  cert.setIssuer([{ name: 'commonName', value: commonName }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return forge.util.encode64(derBytes);
}

function makePortalCert(opts: {
  serialNumber: string;
  certificateId: string;
  name?: string;
  expirationDate: string;
}): AppleCertificate {
  return {
    serialNumber: opts.serialNumber,
    certificateId: opts.certificateId,
    name: opts.name ?? `iOS Development: Test (${opts.serialNumber.slice(-4)})`,
    machineName: 'TestMachine',
    certificateType: { name: 'iOS Development', displayName: 'iOS Development' },
    expirationDate: opts.expirationDate,
    certContent: '',
    status: 'Issued',
  };
}

function buildMocks(opts: {
  portalCerts: AppleCertificate[];
  ownership?: Array<{ id: string; portalCertificateId: string; serialNumber: string; revokedAt: string | null }>;
  submitCSRSucceeds: boolean;
}) {
  const ownership = opts.ownership ?? [];
  const db = {
    getActiveCertificate: vi.fn(() => null),
    listCertificateOwnership: vi.fn(() => ownership),
    getCertificateById: vi.fn(() => null),
    saveCertificate: vi.fn(),
    hardDeleteCertificate: vi.fn(),
  } as any;
  const client = {
    listCertificates: vi.fn(async () => opts.portalCerts),
    revokeCertificate: vi.fn(async () => {}),
    submitCSR: vi.fn(async () => {
      if (!opts.submitCSRSucceeds) {
        const e = new Error('Apple rejected CSR (simulated)');
        throw e;
      }
      return {
        serialNumber: 'NEWCERT123',
        certificateId: 'portal-new-1',
        name: 'iOS Development: SideLink',
        machineName: 'SideLink',
        certificateType: { name: 'iOS Development', displayName: 'iOS Development' },
        expirationDate: '2027-12-31T00:00:00.000Z',
        certContent: makeDerCertBase64('SideLink'),
        status: 'Issued',
      } as AppleCertificate;
    }),
  } as any;
  const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() } as any;
  return { db, client, logs };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('CertificateManager.ensureCertificate — account-tier policy', () => {
  it('FREE tier auto-revokes active unmanaged certs and submits a fresh CSR', async () => {
    const portalCerts = [
      makePortalCert({ serialNumber: 'AAAA1111', certificateId: 'p1', expirationDate: '2027-01-01T00:00:00.000Z' }),
      makePortalCert({ serialNumber: 'BBBB2222', certificateId: 'p2', expirationDate: '2027-06-01T00:00:00.000Z' }),
    ];
    const { db, client, logs } = buildMocks({ portalCerts, submitCSRSucceeds: true });

    const manager = new CertificateManager(db, client, logs);
    const result = await manager.ensureCertificate('account-1', 'TEAM123', 'free');

    expect(client.revokeCertificate).toHaveBeenCalledTimes(2);
    expect(client.revokeCertificate).toHaveBeenCalledWith('TEAM123', 'AAAA1111');
    expect(client.revokeCertificate).toHaveBeenCalledWith('TEAM123', 'BBBB2222');
    expect(client.submitCSR).toHaveBeenCalledTimes(1);
    expect(result.serialNumber).toBe('NEWCERT123');
    expect(db.saveCertificate).toHaveBeenCalledTimes(1);

    // Each external revoke should emit a CERT_REVOKED log with reason
    const revokeLogs = (logs.info as any).mock.calls.filter((c: any[]) => c[0] === 'CERT_REVOKED');
    expect(revokeLogs).toHaveLength(2);
    expect(revokeLogs[0][2]).toMatchObject({ reason: 'free-tier-quota' });
  });

  it('PAID tier refuses to revoke active unmanaged certs and surfaces friendly error with portal URL only', async () => {
    const portalCerts = [
      makePortalCert({
        serialNumber: 'AAAA1111',
        certificateId: 'p1',
        name: 'iOS Development: Test',
        expirationDate: '2027-01-01T00:00:00.000Z',
      }),
    ];
    const { db, client, logs } = buildMocks({ portalCerts, submitCSRSucceeds: false });

    const manager = new CertificateManager(db, client, logs);
    await expect(manager.ensureCertificate('account-1', 'TEAM123', 'paid'))
      .rejects.toThrow(/development certificates for this team that were not created by SideLink/);

    expect(client.revokeCertificate).not.toHaveBeenCalled();
    try {
      await manager.ensureCertificate('account-1', 'TEAM123', 'paid');
    } catch (e: any) {
      expect(e.message).toContain('developer.apple.com/account/resources/certificates/list');
      // Paid-only message must NOT include the Xcode hint (that's for unknown tier)
      expect(e.message).not.toContain('Xcode → Settings');
    }
  });

  it('UNKNOWN tier surfaces friendly error with BOTH Xcode and portal options', async () => {
    const portalCerts = [
      makePortalCert({ serialNumber: 'AAAA1111', certificateId: 'p1', expirationDate: '2027-01-01T00:00:00.000Z' }),
    ];
    const { db, client } = buildMocks({ portalCerts, submitCSRSucceeds: false });

    const manager = new CertificateManager(db, client);
    try {
      await manager.ensureCertificate('account-1', 'TEAM123', 'unknown');
      throw new Error('expected ensureCertificate to throw');
    } catch (e: any) {
      expect(e.message).toContain('Xcode → Settings → Accounts');
      expect(e.message).toContain('developer.apple.com/account/resources/certificates/list');
    }
    expect(client.revokeCertificate).not.toHaveBeenCalled();
  });

  it('PAID tier still auto-revokes EXPIRED unmanaged certs (they are useless and occupy quota)', async () => {
    const portalCerts = [
      makePortalCert({
        serialNumber: 'EXPIRED1',
        certificateId: 'p1',
        expirationDate: '2020-01-01T00:00:00.000Z', // expired
      }),
      makePortalCert({
        serialNumber: 'ACTIVE1',
        certificateId: 'p2',
        expirationDate: '2027-01-01T00:00:00.000Z',
      }),
    ];
    const { db, client, logs } = buildMocks({ portalCerts, submitCSRSucceeds: false });

    const manager = new CertificateManager(db, client, logs);
    // Should still throw because ACTIVE1 is unmanaged and tier is paid
    await expect(manager.ensureCertificate('account-1', 'TEAM123', 'paid')).rejects.toThrow();

    // But EXPIRED1 should have been auto-revoked before the throw
    expect(client.revokeCertificate).toHaveBeenCalledTimes(1);
    expect(client.revokeCertificate).toHaveBeenCalledWith('TEAM123', 'EXPIRED1');

    const revokeLogs = (logs.info as any).mock.calls.filter((c: any[]) => c[0] === 'CERT_REVOKED');
    expect(revokeLogs).toHaveLength(1);
    expect(revokeLogs[0][2]).toMatchObject({ reason: 'expired' });
  });

  it('FREE tier with mixed expired + active unmanaged certs revokes ALL of them', async () => {
    const portalCerts = [
      makePortalCert({ serialNumber: 'EXPIRED1', certificateId: 'p1', expirationDate: '2020-01-01T00:00:00.000Z' }),
      makePortalCert({ serialNumber: 'ACTIVE1', certificateId: 'p2', expirationDate: '2027-01-01T00:00:00.000Z' }),
    ];
    const { db, client, logs } = buildMocks({ portalCerts, submitCSRSucceeds: true });

    const manager = new CertificateManager(db, client, logs);
    await manager.ensureCertificate('account-1', 'TEAM123', 'free');

    expect(client.revokeCertificate).toHaveBeenCalledTimes(2);
    expect(client.revokeCertificate).toHaveBeenCalledWith('TEAM123', 'EXPIRED1');
    expect(client.revokeCertificate).toHaveBeenCalledWith('TEAM123', 'ACTIVE1');
  });

  it('coalesces concurrent ensureCertificate calls for the same (account, team) onto a single CSR submission', async () => {
    // Two pipeline jobs racing the provision step on the same Apple account.
    // Without coalescing, both call submitCSR; Apple rejects the second with
    // `(code: 7460) You already have a current iOS Development certificate or
    // a pending certificate request`.
    const portalCerts = [
      makePortalCert({ serialNumber: 'AAAA1111', certificateId: 'p1', expirationDate: '2027-01-01T00:00:00.000Z' }),
    ];
    const { db, client, logs } = buildMocks({ portalCerts, submitCSRSucceeds: true });

    // Add a small delay inside submitCSR so the second concurrent call has
    // time to enter ensureCertificate before the first resolves.
    const realSubmit = client.submitCSR;
    client.submitCSR = vi.fn(async (...args: any[]) => {
      await new Promise((r) => setTimeout(r, 20));
      return realSubmit(...args);
    });

    const manager = new CertificateManager(db, client, logs);
    const [r1, r2] = await Promise.all([
      manager.ensureCertificate('account-1', 'TEAM123', 'free'),
      manager.ensureCertificate('account-1', 'TEAM123', 'free'),
    ]);

    // Both callers should receive the SAME cert record (same submitCSR call)
    expect(r1.serialNumber).toBe('NEWCERT123');
    expect(r2).toBe(r1);
    expect(client.submitCSR).toHaveBeenCalledTimes(1);
    expect(client.listCertificates).toHaveBeenCalledTimes(1);
    // Each external cert revoked once, not twice
    expect(client.revokeCertificate).toHaveBeenCalledTimes(1);
  });

  it('does NOT coalesce calls for different (account, team) pairs', async () => {
    const portalCerts: AppleCertificate[] = [];
    const { db, client, logs } = buildMocks({ portalCerts, submitCSRSucceeds: true });

    const manager = new CertificateManager(db, client, logs);
    await Promise.all([
      manager.ensureCertificate('account-1', 'TEAM-A', 'free'),
      manager.ensureCertificate('account-2', 'TEAM-B', 'free'),
    ]);

    // Two distinct accounts → two separate provision flows
    expect(client.submitCSR).toHaveBeenCalledTimes(2);
    expect(client.listCertificates).toHaveBeenCalledTimes(2);
  });

  it('reuses an existing valid cached cert without touching the portal', async () => {
    const cached = {
      id: 'cert-cached',
      accountId: 'account-1',
      teamId: 'TEAM123',
      serialNumber: 'CACHED1',
      commonName: 'SideLink',
      certificatePem: '',
      privateKeyPem: '',
      portalCertificateId: 'portal-cached',
      expiresAt: '2099-01-01T00:00:00.000Z',
      revokedAt: null,
      createdAt: '2025-01-01T00:00:00.000Z',
    };
    const { db, client, logs } = buildMocks({ portalCerts: [], submitCSRSucceeds: true });
    db.getActiveCertificate = vi.fn(() => cached);

    const manager = new CertificateManager(db, client, logs);
    const result = await manager.ensureCertificate('account-1', 'TEAM123', 'free');

    expect(result).toBe(cached);
    expect(client.listCertificates).not.toHaveBeenCalled();
    expect(client.revokeCertificate).not.toHaveBeenCalled();
    expect(client.submitCSR).not.toHaveBeenCalled();
  });
});
