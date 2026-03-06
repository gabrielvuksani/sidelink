// ─── Server-only types ──────────────────────────────────────────────
// Types used only on the server side (not shared with client).

// Augment Express Request with our auth fields
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/** Result of running a shell command via CommandRunner */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/** Options for spawning a command */
export interface CommandOptions {
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

/** Audit callback — records every command execution */
export type CommandAuditWriter = (entry: {
  jobId: string;
  command: string;
  args: string[];
  cwd: string | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  notes: string | null;
}) => void;

/** Encryption utilities for at-rest secrets */
export interface EncryptionProvider {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/** pymobiledevice3 JSON device entry */
export interface PMD3DeviceEntry {
  Identifier?: string;
  DeviceClass?: string;
  ConnectionType?: string;
  SerialNumber?: string;
  UniqueDeviceID?: string;
  [key: string]: unknown;
}

/** Signing parameters internal to the signer */
export interface SigningParams {
  ipaPath: string;
  certificatePem: string;
  privateKeyPem: string;
  provisioningProfileData: Buffer;
  targetBundleId: string;
  teamId: string;
  entitlements?: Record<string, unknown>;
  /** Raw Info.plist data for special slot 1 hash computation */
  infoPlistData?: Buffer;
  /** Whether to include app extensions in signing (false = strip PlugIns) */
  includeExtensions?: boolean;
  /** Per-extension provisioning profiles (keyed by rewritten bundle ID) */
  extensionProfiles?: Array<{ bundleId: string; profileData: Buffer }>;
}

/** Result of a signing operation */
export interface SigningResult {
  signedIpaPath: string;
  effectiveBundleId: string;
  effectiveTeamId: string;
  workDir: string;
  cleanup: () => Promise<void>;
}
