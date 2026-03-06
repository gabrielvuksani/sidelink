// ─── Application Context ─────────────────────────────────────────────
// Dependency injection container. All services and their dependencies
// are wired here, making the entire system testable and manageable.
//
// Supports two bootstrap modes:
//  • createAppContext()      — sync, uses legacy encryption (backward-compat)
//  • createAppContextAsync() — async, uses OS keychain encryption (preferred)

import path from 'node:path';
import { Database } from './state/database';
import {
  createEncryptionProvider,
  deriveEncryptionKey,
  createKeychainEncryptionProvider,
  initKeychain,
} from './utils/crypto';
import {
  getDefaultDataDir,
  getDefaultUploadDir,
  getDefaultDbPath,
  ensureDir,
} from './utils/paths';
import { LogService } from './services/log-service';
import { IpaService } from './services/ipa-service';
import { DeviceService } from './services/device-service';
import { AuthService } from './services/auth-service';
import { AppleAccountService } from './services/apple-account-service';
import { ProvisioningService } from './services/provisioning-service';
import { SchedulerService } from './services/scheduler-service';
import { SourceService } from './services/source-service';
import { setAuthLogger } from './apple/apple-auth';
import { setDeviceLogger } from './adapters/device-adapter';
import { setSignerLogger } from './signing/ts-signer';
import type { PipelineDeps } from './pipeline';
import type { EncryptionProvider } from './types';

export interface AppContext {
  db: Database;
  encryption: EncryptionProvider;
  logs: LogService;
  ipas: IpaService;
  devices: DeviceService;
  auth: AuthService;
  appleAccounts: AppleAccountService;
  provisioning: ProvisioningService;
  scheduler: SchedulerService;
  sources: SourceService;
  pipelineDeps: PipelineDeps;
  dataDir: string;
  uploadDir: string;
  shutdown(): void;
}

export interface BootstrapOptions {
  dataDir?: string;
  uploadDir?: string;
  /** @deprecated Pass encryptionSecret for legacy mode only. Prefer async bootstrap. */
  encryptionSecret?: string;
  /** When true, use legacy (sync) encryption even in async bootstrap. */
  forceLegacyEncryption?: boolean;
}

// ── Shared wiring (encryption-agnostic) ──────────────────────────────

function wireServices(
  dataDir: string,
  uploadDir: string,
  encryption: EncryptionProvider,
): AppContext {
  const dbPath = path.join(dataDir, 'sidelink.sqlite');

  // Ensure directories
  ensureDir(dataDir);
  ensureDir(uploadDir);

  // Database
  const db = new Database(dbPath, encryption);

  // Services (order matters — dependencies first)
  const logs = new LogService(db);

  // Route apple-auth module logs through LogService
  setAuthLogger({
    info: (msg) => logs.info('APPLE_AUTH', msg),
    warn: (msg) => logs.warn('APPLE_AUTH', msg),
    error: (msg) => logs.error('APPLE_AUTH', msg),
  });

  // Route device-adapter logs through LogService
  setDeviceLogger({
    warn: (msg) => logs.warn('DEVICE', msg),
  });

  // Route signer logs through LogService
  setSignerLogger({
    warn: (msg) => logs.warn('SIGNER', msg),
    info: (msg) => logs.info('SIGNER', msg),
  });

  const ipas = new IpaService(db, uploadDir);
  const devices = new DeviceService(logs);
  const auth = new AuthService(db, logs);
  const appleAccounts = new AppleAccountService(db, logs, encryption);
  const provisioning = new ProvisioningService(db, logs);

  // Pipeline deps bundle
  const pipelineDeps: PipelineDeps = {
    db, logs, accounts: appleAccounts, provisioning, devices, ipas, encryption,
  };

  // Scheduler
  const scheduler = new SchedulerService(pipelineDeps, db, logs, devices);
  const sources = new SourceService(db);

  return {
    db, encryption, logs, ipas, devices, auth,
    appleAccounts, provisioning, scheduler, sources,
    pipelineDeps, dataDir, uploadDir,
    shutdown() {
      scheduler.stop();
      devices.stopPolling();
      db.close();
    },
  };
}

// ── Resolve directories from options / env / defaults ────────────────

function resolveDirs(opts: BootstrapOptions) {
  const dataDir =
    opts.dataDir ??
    process.env.SIDELINK_DATA_DIR ??
    process.env.DATA_DIR ??
    getDefaultDataDir();

  const uploadDir =
    opts.uploadDir ??
    process.env.SIDELINK_UPLOAD_DIR ??
    process.env.UPLOAD_DIR ??
    getDefaultUploadDir(dataDir);

  return { dataDir, uploadDir };
}

// ── Sync bootstrap (legacy encryption) ───────────────────────────────

/**
 * Create the full application context with all services wired up.
 * Uses synchronous legacy encryption (SHA-256-derived key).
 * @deprecated Prefer createAppContextAsync() for OS keychain encryption.
 */
export function createAppContext(opts: BootstrapOptions = {}): AppContext {
  const { dataDir, uploadDir } = resolveDirs(opts);

  const secret = opts.encryptionSecret ?? deriveEncryptionKey();
  const encryption = createEncryptionProvider(secret);

  return wireServices(dataDir, uploadDir, encryption);
}

// ── Async bootstrap (OS keychain encryption — preferred) ─────────────

/**
 * Create the full application context using OS keychain-backed encryption.
 * Falls back to PBKDF2-based encryption if keytar is not available.
 * This is the preferred bootstrap path for production.
 */
export async function createAppContextAsync(opts: BootstrapOptions = {}): Promise<AppContext> {
  const { dataDir, uploadDir } = resolveDirs(opts);

  let encryption: EncryptionProvider;

  if (opts.forceLegacyEncryption || opts.encryptionSecret) {
    // Explicit legacy mode
    const secret = opts.encryptionSecret ?? deriveEncryptionKey();
    encryption = createEncryptionProvider(secret);
  } else {
    // Initialize OS keychain and create provider
    await initKeychain();
    encryption = await createKeychainEncryptionProvider();
  }

  return wireServices(dataDir, uploadDir, encryption);
}
