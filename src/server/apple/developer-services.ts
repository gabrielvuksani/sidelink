// ─── Apple Developer Services Client ────────────────────────────────
// Interacts with Apple's Developer Services API to manage:
//   - Teams
//   - Devices (UDID registration)
//   - Certificates (create, revoke, list)
//   - App IDs (create, list, delete)
//   - Provisioning Profiles (create, download, delete)
//
// Works with both free and paid Apple Developer accounts.
// Free accounts use the same endpoints but have stricter limits.
//
// Uses the GSA auth session: requests are XML plist-encoded with
// X-Apple-GS-Token + X-Apple-I-Identity-Id headers (matching AltSign).

import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { buildAppleHeaders } from './anisette';
import type { AuthSession } from './apple-auth';
import { APPLE_ENDPOINTS, DEVELOPER_PATHS } from '../../shared/constants';
import { ProvisioningError } from '../utils/errors';
import { buildPlist } from '../utils/plist';
import plistLib from 'plist';

/**
 * The `plist` npm library parses `<data>` XML tags into raw `Buffer`
 * objects (decoded from base64). Many Apple fields like certContent
 * and encodedProfile arrive this way. This helper normalises the
 * value back to a base64 string that node-forge / other consumers
 * expect.
 */
function normalizeBase64(value: unknown): string | undefined {
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

/**
 * The `plist` library parses `<date>` XML tags into JS `Date` objects.
 * This helper converts any date-like value to an ISO string safely.
 * Returns '' if the value cannot be converted.
 */
function normalizeDate(value: unknown): string {
  if (value instanceof Date) {
    const iso = value.toISOString();
    if (iso !== 'Invalid Date') return iso;
    return '';
  }
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }
  return '';
}

/** Apple client ID used by Xcode for developer services. */
const APPLE_CLIENT_ID = 'XABBG36SBA';
/** Protocol version for the QH65B2 endpoint. */
const PROTOCOL_VERSION = 'QH65B2';

// ─── Types ──────────────────────────────────────────────────────────

export interface AppleTeam {
  teamId: string;
  name: string;
  type: 'Individual' | 'Company' | 'In-House' | string;
  status: string;
  memberships: Array<{ membershipType: string }>;
}

export interface AppleDevice {
  deviceId: string;
  deviceNumber: string;
  name: string;
  model: string;
  status: string;
  devicePlatform: string;
}

export interface AppleCertificate {
  serialNumber: string;
  certificateId: string;
  name: string;
  machineName: string;
  certificateType: { name: string; displayName: string };
  expirationDate: string;
  /** Base64-encoded DER certificate data */
  certContent: string;
  status: string;
}

export interface AppleAppId {
  appIdId: string;
  identifier: string;       // Bundle ID (e.g., com.sidelink.XXXX)
  name: string;
  prefix: string;            // Team ID
  status: string;
}

export interface AppleProvisioningProfile {
  provisioningProfileId: string;
  name: string;
  UUID: string;
  status: string;
  type: string;
  expirationDate: string;
  /** Base64-encoded .mobileprovision data */
  encodedProfile: string;
}

// ─── Client ─────────────────────────────────────────────────────────

export class AppleDeveloperServicesClient {
  constructor(private session: AuthSession) {}

  /**
   * Update the session (e.g., after re-auth or 2FA).
   */
  updateSession(session: AuthSession): void {
    this.session = session;
  }

  // ─── Teams ────────────────────────────────────────────────────

  async listTeams(): Promise<AppleTeam[]> {
    const data = await this.request(DEVELOPER_PATHS.listTeams);

    const rawTeams = data.teams || [];

    return rawTeams.map((t: any) => ({
      teamId: t.teamId,
      name: t.name,
      type: t.type,
      status: t.status,
      memberships: t.memberships || t.teamMemberships || [],
    }));
  }

  // ─── Devices ──────────────────────────────────────────────────

  async listDevices(teamId: string): Promise<AppleDevice[]> {
    const data = await this.request(DEVELOPER_PATHS.listDevices, {
      teamId,
    });
    return (data.devices || []).map((d: any) => ({
      deviceId: d.deviceId,
      deviceNumber: d.deviceNumber,
      name: d.name,
      model: d.model,
      status: d.status,
      devicePlatform: d.devicePlatform,
    }));
  }

  async registerDevice(
    teamId: string,
    udid: string,
    name: string,
  ): Promise<AppleDevice> {
    const data = await this.request(DEVELOPER_PATHS.addDevice, {
      teamId,
      deviceNumber: udid,
      name,
      devicePlatform: 'ios',
    });
    const device = data.device;
    if (!device) {
      throw new ProvisioningError(
        'DEVICE_REGISTRATION_FAILED',
        'Apple did not return a device object after registration',
      );
    }
    return {
      deviceId: device.deviceId,
      deviceNumber: device.deviceNumber,
      name: device.name,
      model: device.model,
      status: device.status,
      devicePlatform: device.devicePlatform,
    };
  }

  // ─── Certificates ────────────────────────────────────────────

  async listCertificates(teamId: string): Promise<AppleCertificate[]> {
    const data = await this.request(DEVELOPER_PATHS.listCertificates, {
      teamId,
    });
    const rawCerts = data.certificates || [];
    return rawCerts.map((c: any) => ({
      serialNumber: c.serialNumber ?? c.serialNum ?? '',
      certificateId: c.certificateId ?? '',
      name: c.name ?? '',
      machineName: c.machineName ?? '',
      certificateType: c.certificateType ?? { name: '', displayName: '' },
      expirationDate: normalizeDate(c.expirationDate) || normalizeDate(c.dateExpire),
      certContent: normalizeBase64(c.certContent) ?? '',
      status: c.status ?? c.statusString ?? '',
    }));
  }

  async submitCSR(
    teamId: string,
    csr: string,
    machineName: string = 'SideLink',
  ): Promise<AppleCertificate> {
    const data = await this.request(DEVELOPER_PATHS.submitCSR, {
      teamId,
      csrContent: csr,
      machineId: machineName,
      machineName,
    });

    const cert = data.certRequest;
    if (!cert) {
      throw new ProvisioningError(
        'CSR_SUBMISSION_FAILED',
        'Apple did not return a certificate after CSR submission. '
        + `Response keys: ${Object.keys(data).join(', ')}`,
      );
    }

    // The submitDevelopmentCSR response returns a *request* object — it has
    // `serialNum` (not `serialNumber`) and does NOT include `certContent`
    // or `expirationDate`. We need to fetch the full cert via listCertificates.
    const certId = cert.certificateId ?? '';
    const serialNumber = cert.serialNum ?? cert.serialNumber ?? '';
    // CSR accepted — fetch the full cert with content

    // Fetch the full certificate (including certContent) from the portal
    const fullCerts = await this.listCertificates(teamId);
    const fullCert = fullCerts.find(
      c => c.certificateId === certId || c.serialNumber === serialNumber,
    );

    if (fullCert) {
      return fullCert;
    }

    // Fallback: return what we have from the CSR response (certContent will be empty)
    return {
      serialNumber,
      certificateId: certId,
      name: cert.name ?? '',
      machineName: cert.machineName ?? machineName,
      certificateType: cert.certificateType ?? { name: 'iOS Development', displayName: 'iOS Development' },
      expirationDate: normalizeDate(cert.expirationDate) || normalizeDate(cert.dateExpire),
      certContent: normalizeBase64(cert.certContent) ?? '',
      status: cert.statusString ?? cert.status ?? '',
    };
  }

  async revokeCertificate(
    teamId: string,
    serialNumber: string,
  ): Promise<void> {
    await this.request(DEVELOPER_PATHS.revokeCertificate, {
      teamId,
      serialNumber,
    });
  }

  // ─── App IDs ──────────────────────────────────────────────────

  async listAppIds(teamId: string): Promise<AppleAppId[]> {
    const data = await this.request(DEVELOPER_PATHS.listAppIds, {
      teamId,
    });
    return (data.appIds || []).map((a: any) => ({
      appIdId: a.appIdId,
      identifier: a.identifier,
      name: a.name,
      prefix: a.prefix,
      status: a.status,
    }));
  }

  async createAppId(
    teamId: string,
    bundleId: string,
    name: string,
    type: 'explicit' | 'wildcard' = 'explicit',
  ): Promise<AppleAppId> {
    const data = await this.request(DEVELOPER_PATHS.addAppId, {
      teamId,
      identifier: bundleId,
      name,
      type,
    });
    const appId = data.appId;
    if (!appId) {
      throw new ProvisioningError(
        'APP_ID_CREATION_FAILED',
        `Apple did not return an App ID after creation. Bundle: ${bundleId}`,
      );
    }
    return {
      appIdId: appId.appIdId,
      identifier: appId.identifier,
      name: appId.name,
      prefix: appId.prefix,
      status: appId.status,
    };
  }

  async deleteAppId(
    teamId: string,
    appIdId: string,
  ): Promise<void> {
    await this.request(DEVELOPER_PATHS.deleteAppId, {
      teamId,
      appIdId,
    });
  }

  // ─── Provisioning Profiles ────────────────────────────────────

  async listProvisioningProfiles(teamId: string): Promise<AppleProvisioningProfile[]> {
    const data = await this.request(DEVELOPER_PATHS.listProvisioningProfiles, {
      teamId,
    });
    return (data.provisioningProfiles || []).map((p: any) => ({
      provisioningProfileId: p.provisioningProfileId,
      name: p.name,
      UUID: p.UUID,
      status: p.status,
      type: p.type,
      expirationDate: normalizeDate(p.expirationDate),
      encodedProfile: normalizeBase64(p.encodedProfile) ?? p.encodedProfile ?? '',
    }));
  }

  async downloadProvisioningProfile(
    teamId: string,
    appIdId: string,
  ): Promise<AppleProvisioningProfile> {
    const data = await this.request(DEVELOPER_PATHS.downloadProfile, {
      teamId,
      appIdId,
    });
    const profile = data.provisioningProfile;
    if (!profile) {
      throw new ProvisioningError(
        'PROFILE_DOWNLOAD_FAILED',
        'Apple did not return a provisioning profile',
      );
    }
    return {
      provisioningProfileId: profile.provisioningProfileId,
      name: profile.name,
      UUID: profile.UUID,
      status: profile.status,
      type: profile.type,
      expirationDate: normalizeDate(profile.expirationDate),
      encodedProfile: normalizeBase64(profile.encodedProfile) ?? profile.encodedProfile ?? '',
    };
  }

  async deleteProvisioningProfile(
    teamId: string,
    profileId: string,
  ): Promise<void> {
    await this.request(DEVELOPER_PATHS.deleteProfile, {
      teamId,
      provisioningProfileId: profileId,
    });
  }

  // ─── Internal Request Helper ──────────────────────────────────

  /**
   * Send a request to Apple Developer Services (QH65B2 endpoint).
   * Matches the AltSign sendRequestWithURL format:
   *   - Body: XML plist with clientId, protocolVersion, requestId, + params
   *   - Auth: X-Apple-GS-Token + X-Apple-I-Identity-Id headers
   *   - Content-Type: text/x-xml-plist
   *   - Response: XML plist
   */
  private async request(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<any> {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const url = `${APPLE_ENDPOINTS.developerServices}${path}?clientId=${APPLE_CLIENT_ID}`;

      const plistBody: Record<string, unknown> = {
        clientId: APPLE_CLIENT_ID,
        protocolVersion: PROTOCOL_VERSION,
        requestId: randomUUID().toUpperCase(),
        ...body,
      };

      const xmlBody = buildPlist(plistBody);

      const headers = await buildAppleHeaders({
        'X-Apple-GS-Token': this.session.sessionToken,
        'X-Apple-I-Identity-Id': this.session.sessionId,
        'Content-Type': 'text/x-xml-plist',
        'Accept': 'text/x-xml-plist',
        'Accept-Language': 'en-us',
      });

      let response: Response;
      try {
        response = await fetch(url, { method: 'POST', headers, body: xmlBody });
      } catch (err) {
        // Network error — retry with backoff
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt)));
          continue;
        }
        throw new ProvisioningError(
          'APPLE_DEVELOPER_API_ERROR',
          `Apple Developer Services network error after ${MAX_RETRIES} attempts: ${String(err)}`,
        );
      }

      // 401/403 are auth errors — don't retry
      if (response.status === 401 || response.status === 403) {
        throw new ProvisioningError(
          'APPLE_SESSION_EXPIRED',
          'Apple session has expired. Please re-authenticate.',
          'Log in with your Apple ID again.',
        );
      }

      // Server errors (5xx) and 429 — retry with backoff
      if ((response.status >= 500 || response.status === 429) && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt)));
        continue;
      }

      const responseText = await response.text();
      let data: any;
      try {
        data = plistLib.parse(responseText);
      } catch {
        try {
          data = JSON.parse(responseText);
        } catch {
          throw new ProvisioningError(
            'APPLE_DEVELOPER_API_ERROR',
            `Apple Developer Services returned unparseable response (HTTP ${response.status}): ${responseText.slice(0, 200)}`,
          );
        }
      }

      if (data.resultCode && data.resultCode !== 0) {
        const msg = data.userString || data.resultString || `Error code ${data.resultCode}`;
        throw new ProvisioningError(
          'APPLE_DEVELOPER_API_ERROR',
          `Apple Developer Services: ${msg} (code: ${data.resultCode})`,
        );
      }

      return data;
    }
  }
}
