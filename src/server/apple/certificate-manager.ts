// ─── Certificate Manager ────────────────────────────────────────────
// Generates RSA keypairs, creates CSRs, submits to Apple, and manages
// the lifecycle of development certificates.
//
// For free accounts: max 1-2 active development certs, 7-day expiry.
// For paid accounts: longer expiry, more certs allowed.

import forge from 'node-forge';
import { v4 as uuid } from 'uuid';
import type { CertificateRecord } from '../../shared/types';
import type { AppleDeveloperServicesClient, AppleCertificate } from './developer-services';
import type { Database } from '../state/database';
import type { LogService } from '../services/log-service';
import { ProvisioningError } from '../utils/errors';

type AppleAccountTier = 'free' | 'paid' | 'unknown';

/**
 * Generate an RSA 2048-bit keypair and a Certificate Signing Request.
 * Returns PEM-encoded private key and CSR (base64 DER).
 */
export function generateCSR(commonName: string = 'SideLink'): {
  privateKeyPem: string;
  csrBase64: string;
} {
  // Generate RSA keypair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create CSR
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { name: 'commonName', value: commonName },
    { name: 'countryName', value: 'US' },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());

  // Export
  const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const csrDer = forge.asn1.toDer(forge.pki.certificationRequestToAsn1(csr));
  const csrBase64 = forge.util.encode64(csrDer.getBytes());

  return { privateKeyPem, csrBase64 };
}

/**
 * Convert Apple's DER certificate (base64) to PEM format.
 */
export function derToPem(base64Der: string): string {
  const derBytes = forge.util.decode64(base64Der);
  const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(derBytes));
  return forge.pki.certificateToPem(cert);
}

/**
 * Extract the serial number from a PEM certificate.
 */
export function extractSerialNumber(pem: string): string {
  const cert = forge.pki.certificateFromPem(pem);
  return cert.serialNumber;
}

/**
 * Check if a certificate is expired.
 */
export function isCertificateExpired(expiresAt: string): boolean {
  return new Date(expiresAt) <= new Date();
}

// ─── Certificate Manager Service ────────────────────────────────────

export class CertificateManager {
  constructor(
    private db: Database,
    private client: AppleDeveloperServicesClient,
    private logs?: LogService,
  ) {}

  /**
   * Get or create a valid development certificate for the account+team.
   * If no valid cert exists, creates one. If at limit, revokes oldest.
   *
   * `accountType` controls how aggressively SideLink reclaims unmanaged portal
   * certs. Free Apple IDs cap at 2 dev certs and have no portal to manage
   * them, so we auto-revoke EVERY unmanaged cert when needed. Paid teams get
   * the conservative treatment (only expired certs auto-revoke) because they
   * have a working portal and may legitimately share certs across tools.
   */
  async ensureCertificate(
    accountId: string,
    teamId: string,
    accountType: AppleAccountTier = 'unknown',
  ): Promise<CertificateRecord> {
    // 1. Check for existing valid cert in our DB
    const existingCert = this.db.getActiveCertificate(accountId, teamId);
    if (existingCert && !isCertificateExpired(existingCert.expiresAt)) {
      return existingCert;
    }

    // 2. List certs from Apple portal to see current state
    const portalCerts = await this.client.listCertificates(teamId);
    const devCerts = portalCerts.filter(c =>
      c.certificateType?.name?.includes('Development') ||
      c.name?.includes('Development'),
    );

    // 3. Revoke only SideLink-managed certs when we need to make room.
    // Never revoke active unrelated portal certs automatically — they may
    // belong to Xcode, AltStore, or another tool using the same Apple team.
    //
    // `listCertificateOwnership` returns raw metadata WITHOUT decrypting,
    // so quarantined rows (stale-encryption, invisible to `listCertificates`)
    // still count as SideLink-owned. Otherwise a single undecryptable row
    // made every portal cert appear "unmanaged" and blocked the user with
    // `ProvisioningError: Apple already has development certificates...`.
    const ownership = this.db.listCertificateOwnership(accountId);
    const knownByPortalId = new Set(ownership.map((cert) => cert.portalCertificateId));
    const knownBySerial = new Set(ownership.map((cert) => cert.serialNumber));
    const sidelinkManagedPortalCerts = devCerts.filter((cert) =>
      knownByPortalId.has(cert.certificateId) || knownBySerial.has(cert.serialNumber),
    );
    const unmanagedPortalCerts = devCerts.filter((cert) =>
      !knownByPortalId.has(cert.certificateId) && !knownBySerial.has(cert.serialNumber),
    );

    // Split unmanaged certs into "auto-revoke" vs "refuse" based on tier:
    //
    // EXPIRED unmanaged certs are always auto-revokable — they still occupy
    // the free-account 2-cert quota in Apple's portal until manually deleted,
    // but are useless for signing (iOS rejects any signature with an expired
    // cert). Revoking is safe; nothing using them could break.
    //
    // ACTIVE unmanaged certs are auto-revokable ONLY for free-tier accounts.
    // Free Apple IDs cap at 2 dev certs and have NO web portal to manage them
    // (developer.apple.com/account/resources/certificates/list returns 403
    // for free accounts — that page is paid-only). The only other surface is
    // Xcode → Settings → Accounts → Manage Certificates, which requires both
    // Xcode and the original private key. If we refused to revoke for free
    // tier, users with prior Xcode certs would be permanently stuck. AltStore
    // and Sideloadly take the same approach.
    //
    // Paid/unknown accounts keep the conservative treatment — paid teams have
    // a working portal AND legitimately share certs with Xcode/AltStore.
    const certsToAutoRevoke: AppleCertificate[] = [];
    const certsToRefuse: AppleCertificate[] = [];
    for (const cert of unmanagedPortalCerts) {
      const isExpired = cert.expirationDate ? isCertificateExpired(cert.expirationDate) : false;
      if (isExpired || accountType === 'free') {
        certsToAutoRevoke.push(cert);
      } else {
        certsToRefuse.push(cert);
      }
    }

    for (const cert of certsToAutoRevoke) {
      const isExpired = cert.expirationDate ? isCertificateExpired(cert.expirationDate) : false;
      try {
        await this.client.revokeCertificate(teamId, cert.serialNumber);
        this.logs?.info(
          'CERT_REVOKED',
          `Auto-revoked external dev cert "${cert.name || cert.machineName || 'unnamed'}" ` +
            (isExpired ? '(expired, reclaiming portal slot)' : '(free-tier quota cleanup)'),
          {
            accountId,
            teamId,
            serialNumber: cert.serialNumber,
            portalCertificateId: cert.certificateId,
            commonName: cert.name || cert.machineName,
            expirationDate: cert.expirationDate,
            reason: isExpired ? 'expired' : 'free-tier-quota',
          },
        );
      } catch {
        // Best-effort — Apple may already have removed it.
      }
    }

    for (const cert of sidelinkManagedPortalCerts) {
      try {
        // Revoke only our own portal certs to make room for a new CSR.
        await this.client.revokeCertificate(teamId, cert.serialNumber);
      } catch (e) {
        // Revocation may fail (cert already gone, etc.) — continue.
      }
      const local = ownership.find((entry) =>
        entry.portalCertificateId === cert.certificateId || entry.serialNumber === cert.serialNumber,
      );
      if (!local) continue;

      // If the local row was quarantined (stale encryption, undecryptable
      // private key), hard-delete it after successful portal revocation.
      // Leaving it around as "revoked" would keep the ownership fingerprint
      // alive on every subsequent run but with no recoverable private key —
      // pure dead weight that can confuse downstream reconciliation.
      let isQuarantined = false;
      try {
        const decodable = this.db.getCertificateById(local.id);
        isQuarantined = decodable === null;
      } catch {
        isQuarantined = true;
      }
      if (isQuarantined) {
        this.db.hardDeleteCertificate(local.id);
        continue;
      }

      if (!local.revokedAt) {
        const existing = this.db.getCertificateById(local.id);
        if (existing) {
          this.db.saveCertificate({
            ...existing,
            revokedAt: new Date().toISOString(),
          });
        }
      }
    }

    // 4. Generate new keypair + CSR
    const { privateKeyPem, csrBase64 } = generateCSR(`SideLink (${accountId.slice(0, 8)})`);

    // 5. Submit CSR to Apple (this also fetches the full cert via listCertificates)
    let appleCert: AppleCertificate;
    try {
      appleCert = await this.client.submitCSR(teamId, csrBase64, 'SideLink');
    } catch (error) {
      // The friendly error only fires when there are unmanaged certs we
      // refused to touch. For free-tier accounts `certsToRefuse` is always
      // empty (everything was auto-revoked above), so this branch is
      // unreachable for them — they hit the generic submitCSR error instead.
      if (certsToRefuse.length > 0) {
        const lines = certsToRefuse.map((cert) => {
          const cn = cert.name || cert.machineName || 'Unnamed certificate';
          const serialTail = (cert.serialNumber || '').slice(-8) || 'unknown';
          const expiresAt = cert.expirationDate
            ? cert.expirationDate.split('T')[0]
            : 'unknown date';
          return `  • "${cn}" — serial ending …${serialTail}, expires ${expiresAt}`;
        }).join('\n');

        // The portal URL only works for paid teams — free accounts get a 403
        // on developer.apple.com/account/resources/certificates/list because
        // that page is gated behind the Apple Developer Program. For tier
        // 'unknown' (rare — happens when team detection regresses) we surface
        // both options so the user can pick the right one.
        const guidance = accountType === 'unknown'
          ? '\n\nIf this is a free Apple ID, open Xcode → Settings → Accounts → ' +
            'select your account → Manage Certificates, then delete one of these. ' +
            '(SideLink should also detect free tier on the next sign-in and revoke ' +
            'them automatically — try signing the account out and back in.)\n\n' +
            'If this is a paid Apple Developer Program account, sign in to ' +
            'https://developer.apple.com/account/resources/certificates/list and ' +
            'revoke one of these, then try again:\n'
          : '\nSign in to https://developer.apple.com/account/resources/certificates/list and ' +
            'revoke one of these, then try again:\n';

        throw new ProvisioningError(
          'EXTERNAL_DEV_CERT_PRESENT',
          'Apple already has development certificates for this team that were not created by SideLink. ' +
          'SideLink will not revoke certificates that may belong to Xcode or another tool.' +
          guidance + lines,
        );
      }
      throw error;
    }

    if (!appleCert.certContent) {
      throw new ProvisioningError(
        'CERT_CONTENT_MISSING',
        `Apple returned a certificate (serial: ${appleCert.serialNumber || 'unknown'}) `
        + 'but the certContent field is missing. Cannot convert to PEM.',
      );
    }

    // 6. Convert to PEM
    const certificatePem = derToPem(appleCert.certContent);

    // 7. Save to our DB — use a safe expiry fallback (7 days for free accounts)
    const expiresAt = appleCert.expirationDate
      || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // 8. Save to our DB
    const certRecord: CertificateRecord = {
      id: uuid(),
      accountId,
      teamId,
      serialNumber: appleCert.serialNumber,
      commonName: appleCert.name,
      certificatePem,
      privateKeyPem,
      portalCertificateId: appleCert.certificateId,
      expiresAt,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };

    this.db.saveCertificate(certRecord);
    return certRecord;
  }

  /**
   * Revoke a certificate (both in Apple portal and locally).
   */
  async revokeCertificate(certId: string): Promise<void> {
    const cert = this.db.getCertificateById(certId);
    if (!cert) throw new ProvisioningError('CERT_NOT_FOUND', 'Certificate not found');

    try {
      await this.client.revokeCertificate(cert.teamId, cert.serialNumber);
    } catch {
      // Portal revocation may fail if cert is already expired/revoked
    }

    cert.revokedAt = new Date().toISOString();
    this.db.saveCertificate(cert);
  }

  /**
   * List all certificates for an account.
   */
  listCertificates(accountId: string): CertificateRecord[] {
    return this.db.listCertificates(accountId);
  }
}
