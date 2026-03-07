// ─── Database ───────────────────────────────────────────────────────
// SQLite-backed persistence for the entire SideLink system.
// Single-file state with WAL mode, integrity checking, and migration.

import BetterSqlite3 from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import type {
  AppleAccount,
  CertificateRecord,
  AppIdRecord,
  ProvisioningProfileRecord,
  DeviceRegistration,
  IpaArtifact,
  InstallJob,
  InstalledApp,
  LogEntry,
  LogLevel,
  SourceManifest,
  UserSource,
  UserSourceWithManifest,
} from '../../shared/types';
import type { EncryptionProvider } from '../types';

const SCHEMA_VERSION = 7;

// Migration steps — each bumps the version by 1
type Migration = { version: number; description: string; sql: string };
const MIGRATIONS: Migration[] = [
  // Version 2: Add job_command_runs table for command audit trail,
  // add indexes for common queries
  {
    version: 2,
    description: 'Add command audit trail and performance indexes',
    sql: `
      CREATE TABLE IF NOT EXISTS job_command_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        step_name TEXT,
        command TEXT NOT NULL,
        args TEXT,
        cwd TEXT,
        exit_code INTEGER,
        stdout TEXT,
        stderr TEXT,
        duration_ms INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_job_command_runs_job ON job_command_runs(job_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_device ON jobs(device_udid);
      CREATE INDEX IF NOT EXISTS idx_installed_expires ON installed_apps(expires_at);
      CREATE INDEX IF NOT EXISTS idx_certs_account ON certificates(account_id, team_id);
    `,
  },
  // Version 3: Add unique constraint on installed_apps(device_udid, bundle_id)
  {
    version: 3,
    description: 'Add unique constraint on installed_apps to prevent duplicates',
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_installed_device_bundle ON installed_apps(device_udid, bundle_id);
    `,
  },
  // Version 4: Fix FK constraints — add ON DELETE SET NULL for ipa_id references
  // so deleting an IPA doesn't orphan or cascade-delete jobs/installed_apps.
  {
    version: 4,
    description: 'Fix FK constraints on jobs and installed_apps ipa_id columns',
    sql: `
      -- Recreate jobs table with ON DELETE SET NULL for ipa_id
      CREATE TABLE IF NOT EXISTS jobs_v4 (
        id TEXT PRIMARY KEY,
        ipa_id TEXT,
        device_udid TEXT NOT NULL,
        account_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        current_step TEXT,
        steps_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (ipa_id) REFERENCES ipas(id) ON DELETE SET NULL,
        FOREIGN KEY (account_id) REFERENCES apple_accounts(id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO jobs_v4 SELECT * FROM jobs;
      DROP TABLE IF EXISTS jobs;
      ALTER TABLE jobs_v4 RENAME TO jobs;
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_device ON jobs(device_udid);

      -- Recreate installed_apps table with ON DELETE SET NULL for ipa_id
      CREATE TABLE IF NOT EXISTS installed_apps_v4 (
        id TEXT PRIMARY KEY,
        device_udid TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ipa_id TEXT,
        bundle_id TEXT NOT NULL,
        original_bundle_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        app_version TEXT NOT NULL,
        certificate_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        signed_ipa_path TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_refresh_at TEXT,
        refresh_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (account_id) REFERENCES apple_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (ipa_id) REFERENCES ipas(id) ON DELETE SET NULL,
        UNIQUE(device_udid, bundle_id)
      );
      INSERT OR IGNORE INTO installed_apps_v4 (
        id, device_udid, account_id, ipa_id, bundle_id, original_bundle_id,
        app_name, app_version, certificate_id, profile_id, signed_ipa_path,
        installed_at, expires_at, last_refresh_at, refresh_count
      )
      SELECT
        id, device_udid, account_id, ipa_id, bundle_id, original_bundle_id,
        app_name, app_version, certificate_id, profile_id, signed_ipa_path,
        installed_at, expires_at, last_refresh_at, refresh_count
      FROM installed_apps;
      DROP TABLE IF EXISTS installed_apps;
      ALTER TABLE installed_apps_v4 RENAME TO installed_apps;
      CREATE INDEX IF NOT EXISTS idx_installed_expires ON installed_apps(expires_at);
    `,
  },
  // Version 5: Add extensions column to ipas, include_extensions to jobs
  {
    version: 5,
    description: 'Add IPA extensions metadata and job include_extensions flag',
    sql: `
      ALTER TABLE ipas ADD COLUMN extensions TEXT DEFAULT '[]';
      ALTER TABLE jobs ADD COLUMN include_extensions INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 6,
    description: 'Add source management table with cached manifests',
    sql: `
      CREATE TABLE IF NOT EXISTS app_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        identifier TEXT,
        icon_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        cached_manifest TEXT,
        last_fetched_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_sources_enabled ON app_sources(enabled);
      CREATE INDEX IF NOT EXISTS idx_app_sources_builtin ON app_sources(is_builtin);
    `,
  },
  {
    version: 7,
    description: 'Track installed app activation status',
    sql: `
      ALTER TABLE installed_apps ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      CREATE INDEX IF NOT EXISTS idx_installed_status ON installed_apps(status);
    `,
  },
];

// ─── Database Class ─────────────────────────────────────────────────

export class Database {
  private db: BetterSqlite3.Database;
  private logInsertCount = 0;
  private static readonly LOG_PRUNE_INTERVAL = 100;

  constructor(
    dbPath: string,
    private readonly encryption: EncryptionProvider,
  ) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = this.openWithRecovery(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  // ─── Open with Corruption Recovery ──────────────────────────────

  private openWithRecovery(dbPath: string): BetterSqlite3.Database {
    try {
      const db = new BetterSqlite3(dbPath);
      const check = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (check[0]?.integrity_check !== 'ok') {
        db.close();
        this.quarantine(dbPath);
        return new BetterSqlite3(dbPath);
      }
      return db;
    } catch {
      this.quarantine(dbPath);
      return new BetterSqlite3(dbPath);
    }
  }

  private quarantine(dbPath: string): void {
    const dir = path.dirname(dbPath);
    const backupDir = path.join(dir, 'corrupt-backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.basename(dbPath);
    for (const ext of ['', '-wal', '-shm']) {
      const src = dbPath + ext;
      if (fs.existsSync(src)) {
        fs.renameSync(src, path.join(backupDir, `${base}.${ts}${ext}`));
      }
    }
  }

  // ─── Schema Migration ───────────────────────────────────────────

  /** Check whether a column exists on a table */
  private hasColumn(table: string, column: string): boolean {
    const cols = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    return cols.some((c) => c.name === column);
  }

  /** Read the persisted schema version (0 = fresh database) */
  private getSchemaVersion(): number {
    try {
      const row = this.db.prepare(
        "SELECT value FROM settings WHERE key = 'schema_version'",
      ).get() as { value: string } | undefined;
      return row ? Number(row.value) : 0;
    } catch {
      // settings table doesn't exist yet → brand-new db
      return 0;
    }
  }

  private migrate(): void {
    // ── Base schema (version 1) ─────────────────────────────────
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);

      CREATE TABLE IF NOT EXISTS apple_accounts (
        id TEXT PRIMARY KEY,
        apple_id TEXT NOT NULL UNIQUE,
        team_id TEXT NOT NULL,
        team_name TEXT NOT NULL,
        account_type TEXT NOT NULL DEFAULT 'unknown',
        status TEXT NOT NULL DEFAULT 'unauthenticated',
        password_encrypted TEXT,
        cookies_json TEXT,
        last_auth_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS certificates (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        serial_number TEXT NOT NULL,
        common_name TEXT NOT NULL,
        certificate_pem TEXT NOT NULL,
        private_key_pem_enc TEXT NOT NULL,
        portal_certificate_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES apple_accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_ids (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        portal_app_id_id TEXT NOT NULL,
        bundle_id TEXT NOT NULL,
        name TEXT NOT NULL,
        original_bundle_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES apple_accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS provisioning_profiles (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        portal_profile_id TEXT NOT NULL,
        app_id_id TEXT NOT NULL,
        bundle_id TEXT NOT NULL,
        profile_data TEXT NOT NULL,
        file_path TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES apple_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (app_id_id) REFERENCES app_ids(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS device_registrations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        udid TEXT NOT NULL,
        portal_device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES apple_accounts(id) ON DELETE CASCADE,
        UNIQUE(account_id, udid)
      );

      CREATE TABLE IF NOT EXISTS ipas (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        bundle_id TEXT NOT NULL,
        bundle_name TEXT NOT NULL,
        bundle_version TEXT NOT NULL,
        bundle_short_version TEXT NOT NULL,
        min_os_version TEXT,
        icon_data TEXT,
        entitlements TEXT,
        warnings TEXT,
        uploaded_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        ipa_id TEXT,
        device_udid TEXT NOT NULL,
        account_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        current_step TEXT,
        steps_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (ipa_id) REFERENCES ipas(id) ON DELETE SET NULL,
        FOREIGN KEY (account_id) REFERENCES apple_accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS installed_apps (
        id TEXT PRIMARY KEY,
        device_udid TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ipa_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        bundle_id TEXT NOT NULL,
        original_bundle_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        app_version TEXT NOT NULL,
        certificate_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        signed_ipa_path TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_refresh_at TEXT,
        refresh_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (account_id) REFERENCES apple_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (ipa_id) REFERENCES ipas(id) ON DELETE SET NULL,
        UNIQUE(device_udid, bundle_id)
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        meta TEXT,
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_at ON logs(at DESC);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS auth_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        ip TEXT,
        success INTEGER NOT NULL DEFAULT 0,
        attempted_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auth_attempts_user ON auth_attempts(username, attempted_at);
    `);

    // ── Incremental migrations ──────────────────────────────────
    const currentVersion = this.getSchemaVersion();

    if (currentVersion < SCHEMA_VERSION) {
      const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

      for (const migration of pending) {
        this.db.transaction(() => {
          this.db.exec(migration.sql);
          this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
            'schema_version', String(migration.version),
          );
        })();
      }
    }

    // Ensure schema_version is always stored (handles first run)
    if (currentVersion === 0) {
      this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
        'schema_version', String(SCHEMA_VERSION),
      );
    }
  }

  // ─── Apple Accounts ─────────────────────────────────────────────

  upsertAppleAccount(params: {
    appleId: string;
    teamId: string;
    teamName: string;
    accountType: string;
    passwordEncrypted: string;
    cookiesJson: string;
    status: string;
  }): string {
    const existing = this.db.prepare('SELECT id FROM apple_accounts WHERE apple_id = ?')
      .get(params.appleId) as any;
    const id = existing?.id ?? uuid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO apple_accounts (id, apple_id, team_id, team_name, account_type, status, password_encrypted, cookies_json, last_auth_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(apple_id) DO UPDATE SET
        team_id = excluded.team_id,
        team_name = excluded.team_name,
        account_type = excluded.account_type,
        status = excluded.status,
        password_encrypted = excluded.password_encrypted,
        cookies_json = excluded.cookies_json,
        last_auth_at = excluded.last_auth_at
    `).run(id, params.appleId, params.teamId, params.teamName,
      params.accountType, params.status, params.passwordEncrypted,
      params.cookiesJson, now, now);
    return id;
  }

  getAppleAccount(id: string): AppleAccount | null {
    const row = this.db.prepare('SELECT * FROM apple_accounts WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapAccountRow(row);
  }

  getAppleAccountByAppleId(appleId: string): AppleAccount | null {
    const row = this.db.prepare('SELECT * FROM apple_accounts WHERE apple_id = ?').get(appleId) as any;
    if (!row) return null;
    return this.mapAccountRow(row);
  }

  listAppleAccounts(): AppleAccount[] {
    return (this.db.prepare('SELECT * FROM apple_accounts ORDER BY created_at DESC').all() as any[])
      .map(r => this.mapAccountRow(r));
  }

  updateAppleAccountStatus(id: string, status: string): void {
    this.db.prepare('UPDATE apple_accounts SET status = ? WHERE id = ?').run(status, id);
  }

  updateAppleAccountCookies(id: string, cookiesJson: string): void {
    this.db.prepare('UPDATE apple_accounts SET cookies_json = ? WHERE id = ?').run(cookiesJson, id);
  }

  deleteAppleAccount(id: string): void {
    this.db.prepare('DELETE FROM apple_accounts WHERE id = ?').run(id);
  }

  private mapAccountRow(row: any): AppleAccount {
    return {
      id: row.id,
      appleId: row.apple_id,
      teamId: row.team_id,
      teamName: row.team_name,
      accountType: row.account_type,
      status: row.status,
      passwordEncrypted: row.password_encrypted,
      cookiesJson: row.cookies_json,
      lastAuthAt: row.last_auth_at,
      createdAt: row.created_at,
    };
  }

  // ─── Certificates ───────────────────────────────────────────────

  saveCertificate(cert: CertificateRecord): void {
    const encKey = this.encryption.encrypt(cert.privateKeyPem);
    this.db.prepare(`
      INSERT INTO certificates (id, account_id, team_id, serial_number, common_name, certificate_pem, private_key_pem_enc, portal_certificate_id, expires_at, revoked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revoked_at = excluded.revoked_at
    `).run(cert.id, cert.accountId, cert.teamId, cert.serialNumber,
      cert.commonName, cert.certificatePem, encKey,
      cert.portalCertificateId, cert.expiresAt, cert.revokedAt, cert.createdAt);
  }

  getActiveCertificate(accountId: string, teamId: string): CertificateRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM certificates
      WHERE account_id = ? AND team_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(accountId, teamId, new Date().toISOString()) as any;
    if (!row) return null;
    return this.mapCertRow(row);
  }

  listCertificates(accountId: string): CertificateRecord[] {
    return (this.db.prepare('SELECT * FROM certificates WHERE account_id = ? ORDER BY created_at DESC')
      .all(accountId) as any[]).map(r => this.mapCertRow(r));
  }

  getCertificateById(certId: string): CertificateRecord | null {
    const row = this.db.prepare('SELECT * FROM certificates WHERE id = ?').get(certId) as any;
    if (!row) return null;
    return this.mapCertRow(row);
  }

  private mapCertRow(row: any): CertificateRecord {
    return {
      id: row.id,
      accountId: row.account_id,
      teamId: row.team_id,
      serialNumber: row.serial_number,
      commonName: row.common_name,
      certificatePem: row.certificate_pem,
      privateKeyPem: this.encryption.decrypt(row.private_key_pem_enc),
      portalCertificateId: row.portal_certificate_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    };
  }

  // ─── App IDs ────────────────────────────────────────────────────

  saveAppId(appId: AppIdRecord): void {
    this.db.prepare(`
      INSERT INTO app_ids (id, account_id, team_id, portal_app_id_id, bundle_id, name, original_bundle_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
    `).run(appId.id, appId.accountId, appId.teamId, appId.portalAppIdId,
      appId.bundleId, appId.name, appId.originalBundleId, appId.createdAt);
  }

  getAppIdByOriginalBundleId(accountId: string, teamId: string, originalBundleId: string): AppIdRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM app_ids WHERE account_id = ? AND team_id = ? AND original_bundle_id = ?',
    ).get(accountId, teamId, originalBundleId) as any;
    if (!row) return null;
    return this.mapAppIdRow(row);
  }

  listAppIds(accountId: string, teamId: string): AppIdRecord[] {
    return (this.db.prepare('SELECT * FROM app_ids WHERE account_id = ? AND team_id = ? ORDER BY created_at DESC')
      .all(accountId, teamId) as any[]).map(r => this.mapAppIdRow(r));
  }

  countActiveAppIds(accountId: string, teamId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM app_ids WHERE account_id = ? AND team_id = ?',
    ).get(accountId, teamId) as any;
    return row?.count ?? 0;
  }

  countAppIdsCreatedSince(accountId: string, teamId: string, sinceIso: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM app_ids WHERE account_id = ? AND team_id = ? AND created_at >= ?',
    ).get(accountId, teamId, sinceIso) as any;
    return row?.count ?? 0;
  }

  deleteAppId(id: string): void {
    this.db.prepare('DELETE FROM app_ids WHERE id = ?').run(id);
  }

  private mapAppIdRow(row: any): AppIdRecord {
    return {
      id: row.id, accountId: row.account_id, teamId: row.team_id,
      portalAppIdId: row.portal_app_id_id, bundleId: row.bundle_id,
      name: row.name, originalBundleId: row.original_bundle_id,
      createdAt: row.created_at,
    };
  }

  // ─── Provisioning Profiles ─────────────────────────────────────

  saveProfile(profile: ProvisioningProfileRecord & { filePath?: string }): void {
    this.db.prepare(`
      INSERT INTO provisioning_profiles (id, account_id, team_id, portal_profile_id, app_id_id, bundle_id, profile_data, file_path, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET profile_data = excluded.profile_data, file_path = excluded.file_path, expires_at = excluded.expires_at
    `).run(profile.id, profile.accountId, profile.teamId, profile.portalProfileId,
      profile.appIdId, profile.bundleId, profile.profileData,
      profile.filePath ?? null, profile.expiresAt, profile.createdAt);
  }

  getProfile(id: string): (ProvisioningProfileRecord & { filePath?: string }) | null {
    const row = this.db.prepare('SELECT * FROM provisioning_profiles WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapProfileRow(row);
  }

  getActiveProfile(accountId: string, appIdId: string): (ProvisioningProfileRecord & { filePath?: string }) | null {
    const row = this.db.prepare(`
      SELECT * FROM provisioning_profiles
      WHERE account_id = ? AND app_id_id = ? AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(accountId, appIdId, new Date().toISOString()) as any;
    if (!row) return null;
    return this.mapProfileRow(row);
  }

  deleteProfile(id: string): void {
    this.db.prepare('DELETE FROM provisioning_profiles WHERE id = ?').run(id);
  }

  private mapProfileRow(row: any): ProvisioningProfileRecord & { filePath?: string } {
    return {
      id: row.id, accountId: row.account_id, teamId: row.team_id,
      portalProfileId: row.portal_profile_id, appIdId: row.app_id_id,
      bundleId: row.bundle_id, profileData: row.profile_data,
      filePath: row.file_path, expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  // ─── Device Registrations ──────────────────────────────────────

  saveDeviceRegistration(reg: DeviceRegistration): void {
    this.db.prepare(`
      INSERT INTO device_registrations (id, account_id, team_id, udid, portal_device_id, device_name, registered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, udid) DO UPDATE SET portal_device_id = excluded.portal_device_id, device_name = excluded.device_name
    `).run(reg.id, reg.accountId, reg.teamId, reg.udid, reg.portalDeviceId, reg.deviceName, reg.registeredAt);
  }

  getDeviceRegistration(accountId: string, udid: string): DeviceRegistration | null {
    const row = this.db.prepare(
      'SELECT * FROM device_registrations WHERE account_id = ? AND udid = ?',
    ).get(accountId, udid) as any;
    if (!row) return null;
    return { id: row.id, accountId: row.account_id, teamId: row.team_id,
      udid: row.udid, portalDeviceId: row.portal_device_id,
      deviceName: row.device_name, registeredAt: row.registered_at };
  }

  listDeviceRegistrations(accountId: string): DeviceRegistration[] {
    return (this.db.prepare('SELECT * FROM device_registrations WHERE account_id = ? ORDER BY registered_at DESC')
      .all(accountId) as any[]).map(r => ({
      id: r.id, accountId: r.account_id, teamId: r.team_id,
      udid: r.udid, portalDeviceId: r.portal_device_id,
      deviceName: r.device_name, registeredAt: r.registered_at,
    }));
  }

  // ─── IPAs ───────────────────────────────────────────────────────

  saveIpa(ipa: IpaArtifact): void {
    this.db.prepare(`
      INSERT INTO ipas (id, filename, original_name, file_path, file_size, bundle_id, bundle_name, bundle_version, bundle_short_version, min_os_version, icon_data, entitlements, warnings, extensions, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET file_path = excluded.file_path
    `).run(ipa.id, ipa.filename, ipa.originalName, ipa.filePath, ipa.fileSize,
      ipa.bundleId, ipa.bundleName, ipa.bundleVersion, ipa.bundleShortVersion,
      ipa.minOsVersion, ipa.iconData,
      JSON.stringify(ipa.entitlements), JSON.stringify(ipa.warnings),
      JSON.stringify(ipa.extensions ?? []), ipa.uploadedAt);
  }

  getIpa(id: string): IpaArtifact | null {
    const row = this.db.prepare('SELECT * FROM ipas WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapIpaRow(row);
  }

  listIpas(): IpaArtifact[] {
    return (this.db.prepare('SELECT * FROM ipas ORDER BY uploaded_at DESC').all() as any[])
      .map(r => this.mapIpaRow(r));
  }

  deleteIpa(id: string): void {
    this.db.prepare('DELETE FROM ipas WHERE id = ?').run(id);
  }

  private mapIpaRow(row: any): IpaArtifact {
    return {
      id: row.id, filename: row.filename, originalName: row.original_name,
      filePath: row.file_path, fileSize: row.file_size,
      bundleId: row.bundle_id, bundleName: row.bundle_name,
      bundleVersion: row.bundle_version, bundleShortVersion: row.bundle_short_version,
      minOsVersion: row.min_os_version, iconData: row.icon_data,
      entitlements: row.entitlements ? JSON.parse(row.entitlements) : {},
      warnings: row.warnings ? JSON.parse(row.warnings) : [],
      extensions: row.extensions ? JSON.parse(row.extensions) : [],
      uploadedAt: row.uploaded_at,
    };
  }

  // ─── Jobs ───────────────────────────────────────────────────────

  createJob(job: InstallJob): void {
    this.db.prepare(`
      INSERT INTO jobs (id, ipa_id, device_udid, account_id, status, current_step, steps_json, error, created_at, updated_at, include_extensions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(job.id, job.ipaId, job.deviceUdid, job.accountId, job.status,
      job.currentStep, JSON.stringify(job.steps), job.error,
      job.createdAt, job.updatedAt, job.includeExtensions ? 1 : 0);
  }

  updateJob(job: InstallJob): void {
    this.db.prepare(`
      UPDATE jobs SET status = ?, current_step = ?, steps_json = ?, error = ?, updated_at = ? WHERE id = ?
    `).run(job.status, job.currentStep, JSON.stringify(job.steps),
      job.error, job.updatedAt, job.id);
  }

  getJob(id: string): InstallJob | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapJobRow(row);
  }

  listJobs(filters?: { accountId?: string; deviceUdid?: string; status?: string }, limit = 50): InstallJob[] {
    let sql = 'SELECT * FROM jobs WHERE 1=1';
    const params: any[] = [];
    if (filters?.accountId) { sql += ' AND account_id = ?'; params.push(filters.accountId); }
    if (filters?.deviceUdid) { sql += ' AND device_udid = ?'; params.push(filters.deviceUdid); }
    if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    return (this.db.prepare(sql).all(...params) as any[]).map(r => this.mapJobRow(r));
  }

  private mapJobRow(row: any): InstallJob {
    return {
      id: row.id, ipaId: row.ipa_id, deviceUdid: row.device_udid,
      accountId: row.account_id,
      includeExtensions: row.include_extensions === 1,
      status: row.status,
      currentStep: row.current_step,
      steps: row.steps_json ? JSON.parse(row.steps_json) : [],
      error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  // ─── Installed Apps ─────────────────────────────────────────────

  upsertInstalledApp(app: Omit<InstalledApp, 'id'> & { id?: string }): string {
    const id = app.id ?? uuid();
    this.db.prepare(`
      INSERT INTO installed_apps (id, device_udid, account_id, ipa_id, status, bundle_id, original_bundle_id, app_name, app_version, certificate_id, profile_id, signed_ipa_path, installed_at, expires_at, last_refresh_at, refresh_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_udid, bundle_id) DO UPDATE SET
        ipa_id = excluded.ipa_id, status = excluded.status, app_name = excluded.app_name, app_version = excluded.app_version,
        certificate_id = excluded.certificate_id, profile_id = excluded.profile_id,
        signed_ipa_path = excluded.signed_ipa_path, expires_at = excluded.expires_at,
        last_refresh_at = excluded.last_refresh_at, refresh_count = excluded.refresh_count
    `).run(id, app.deviceUdid, app.accountId, app.ipaId, app.status, app.bundleId,
      app.originalBundleId, app.appName, app.appVersion,
      app.certificateId, app.profileId, app.signedIpaPath,
      app.installedAt, app.expiresAt, app.lastRefreshAt ?? null, app.refreshCount ?? 0);
    return id;
  }

  getInstalledApp(id: string): InstalledApp | null {
    const row = this.db.prepare('SELECT * FROM installed_apps WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapInstalledAppRow(row);
  }

  listInstalledApps(): InstalledApp[] {
    return (this.db.prepare('SELECT * FROM installed_apps ORDER BY installed_at DESC').all() as any[])
      .map(r => this.mapInstalledAppRow(r));
  }

  listInstalledAppsByStatus(status: InstalledApp['status']): InstalledApp[] {
    return (this.db.prepare('SELECT * FROM installed_apps WHERE status = ? ORDER BY installed_at DESC').all(status) as any[])
      .map(r => this.mapInstalledAppRow(r));
  }

  listInstalledAppsForDevice(deviceUdid: string): InstalledApp[] {
    return (this.db.prepare('SELECT * FROM installed_apps WHERE device_udid = ? ORDER BY installed_at DESC')
      .all(deviceUdid) as any[]).map(r => this.mapInstalledAppRow(r));
  }

  deleteInstalledApp(id: string): void {
    this.db.prepare('DELETE FROM installed_apps WHERE id = ?').run(id);
  }

  updateInstalledAppStatus(id: string, status: InstalledApp['status']): void {
    this.db.prepare('UPDATE installed_apps SET status = ? WHERE id = ?').run(status, id);
  }

  private mapInstalledAppRow(row: any): InstalledApp {
    return {
      id: row.id, deviceUdid: row.device_udid, accountId: row.account_id,
      ipaId: row.ipa_id, status: row.status ?? 'active', bundleId: row.bundle_id,
      originalBundleId: row.original_bundle_id, appName: row.app_name,
      appVersion: row.app_version, certificateId: row.certificate_id,
      profileId: row.profile_id, signedIpaPath: row.signed_ipa_path,
      installedAt: row.installed_at, expiresAt: row.expires_at,
      lastRefreshAt: row.last_refresh_at, refreshCount: row.refresh_count,
    };
  }

  // ─── Logs ───────────────────────────────────────────────────────

  appendLog(entry: LogEntry): void {
    this.db.prepare(
      'INSERT INTO logs (id, level, code, message, meta, at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(entry.id, entry.level, entry.code, entry.message,
      entry.meta ? JSON.stringify(entry.meta) : null, entry.at);
    // Deterministic pruning every 100 inserts
    this.logInsertCount++;
    if (this.logInsertCount >= Database.LOG_PRUNE_INTERVAL) {
      this.logInsertCount = 0;
      this.db.prepare('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY at DESC LIMIT 5000)').run();
    }
  }

  listLogs(limit = 200): LogEntry[] {
    return (this.db.prepare('SELECT * FROM logs ORDER BY at DESC LIMIT ?').all(limit) as any[])
      .map(r => ({ id: r.id, level: r.level as LogLevel, code: r.code,
        message: r.message, meta: r.meta ? JSON.parse(r.meta) : null, at: r.at }));
  }

  clearLogs(): void {
    this.db.prepare('DELETE FROM logs').run();
  }

  countInstalledAppsByStatus(status: InstalledApp['status']): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM installed_apps WHERE status = ?').get(status) as any;
    return row?.count ?? 0;
  }

  // ─── Settings ───────────────────────────────────────────────────

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  // ─── App Sources ───────────────────────────────────────────────

  upsertSource(source: {
    id: string;
    name: string;
    url: string;
    identifier: string | null;
    iconURL: string | null;
    enabled: boolean;
    isBuiltIn: boolean;
    cachedManifest: SourceManifest | null;
    lastFetchedAt: string | null;
    createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO app_sources (id, name, url, identifier, icon_url, enabled, is_builtin, cached_manifest, last_fetched_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        name = excluded.name,
        identifier = excluded.identifier,
        icon_url = excluded.icon_url,
        enabled = excluded.enabled,
        is_builtin = excluded.is_builtin,
        cached_manifest = excluded.cached_manifest,
        last_fetched_at = excluded.last_fetched_at
    `).run(
      source.id,
      source.name,
      source.url,
      source.identifier,
      source.iconURL,
      source.enabled ? 1 : 0,
      source.isBuiltIn ? 1 : 0,
      source.cachedManifest ? JSON.stringify(source.cachedManifest) : null,
      source.lastFetchedAt,
      source.createdAt,
    );
  }

  getSource(id: string): UserSourceWithManifest | null {
    const row = this.db.prepare('SELECT * FROM app_sources WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapSourceRow(row);
  }

  getSourceByUrl(url: string): UserSourceWithManifest | null {
    const row = this.db.prepare('SELECT * FROM app_sources WHERE url = ?').get(url) as any;
    if (!row) return null;
    return this.mapSourceRow(row);
  }

  listSources(): UserSource[] {
    return (this.db.prepare('SELECT * FROM app_sources ORDER BY is_builtin DESC, created_at ASC').all() as any[])
      .map((row) => this.mapSourceRow(row))
      .map(({ cachedManifest: _cachedManifest, ...source }) => source);
  }

  listSourcesWithManifest(): UserSourceWithManifest[] {
    return (this.db.prepare('SELECT * FROM app_sources ORDER BY is_builtin DESC, created_at ASC').all() as any[])
      .map((row) => this.mapSourceRow(row));
  }

  deleteSource(id: string): void {
    this.db.prepare('DELETE FROM app_sources WHERE id = ?').run(id);
  }

  private mapSourceRow(row: any): UserSourceWithManifest {
    const manifest = row.cached_manifest
      ? (JSON.parse(row.cached_manifest) as SourceManifest)
      : null;
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      identifier: row.identifier,
      iconURL: row.icon_url,
      enabled: row.enabled === 1,
      isBuiltIn: row.is_builtin === 1,
      appCount: Array.isArray(manifest?.apps) ? manifest.apps.length : 0,
      lastFetchedAt: row.last_fetched_at,
      createdAt: row.created_at,
      cachedManifest: manifest,
    };
  }

  // ─── Internal Typed Prepare (used by auth-service) ──────────────────

  /** @internal Only for auth-service. Do not use for ad-hoc queries. */
  prepare<T extends any[] = any[], R = any>(sql: string) {
    return this.db.prepare(sql) as any;
  }

  // ─── Shutdown ───────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
