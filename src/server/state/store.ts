import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  DeviceListResult,
  InstalledAppRecord,
  InstallJob,
  IpaArtifact,
  JobCommandRun,
  LogEntry,
  RuntimeMode,
  SchedulerSnapshot,
  UserRecord,
  UserSessionRecord
} from '../types';

interface StoreOptions {
  dbPath?: string;
}

export interface AuthAttemptRecord {
  key: string;
  username: string;
  count: number;
  firstFailedAt: number;
  lockUntil?: number;
}

const parseJson = <T>(input: string | null | undefined, fallback: T): T => {
  if (!input) {
    return fallback;
  }

  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
};

const asOptionalString = (input: unknown): string | undefined => {
  if (input === null || input === undefined) {
    return undefined;
  }
  const text = String(input).trim();
  return text.length ? text : undefined;
};

const asRuntimeMode = (value: string | undefined, fallback: RuntimeMode): RuntimeMode => {
  if (value === 'real' || value === 'demo') {
    return value;
  }

  return fallback;
};

export class AppStore {
  public mode: RuntimeMode;
  public readonly ipas = new Map<string, IpaArtifact>();
  public readonly jobs = new Map<string, InstallJob>();
  public readonly installedApps = new Map<string, InstalledAppRecord>();
  public readonly deviceCache = new Map<RuntimeMode, DeviceListResult>();

  private readonly db: Database.Database;
  private readonly dbPath: string;
  private schedulerState: SchedulerSnapshot;

  constructor(defaultMode: RuntimeMode, options: StoreOptions = {}) {
    this.dbPath = options.dbPath ?? ':memory:';

    if (this.dbPath !== ':memory:') {
      mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.migrate();

    this.mode = defaultMode;
    this.schedulerState = {
      running: true,
      simulatedNow: new Date().toISOString(),
      tickIntervalMs: 6000,
      simulatedHoursPerTick: 6,
      autoRefreshThresholdHours: 48,
      wifiPreferred: true
    };

    this.load(defaultMode);
  }

  public close(): void {
    this.db.close();
  }

  public getDatabasePath(): string {
    return this.dbPath;
  }

  public newId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }

  public setMode(mode: RuntimeMode): void {
    this.mode = mode;
    this.setSetting('runtime_mode', mode);
  }

  public saveIpa(artifact: IpaArtifact): void {
    this.ipas.set(artifact.id, artifact);

    this.db
      .prepare(
        `
        INSERT INTO ipas (
          id, filename, original_name, absolute_path, uploaded_at, size_bytes,
          bundle_id, display_name, version, min_ios_version,
          entitlements_json, capabilities_json, warnings_json
        ) VALUES (
          @id, @filename, @original_name, @absolute_path, @uploaded_at, @size_bytes,
          @bundle_id, @display_name, @version, @min_ios_version,
          @entitlements_json, @capabilities_json, @warnings_json
        )
        ON CONFLICT(id) DO UPDATE SET
          filename = excluded.filename,
          original_name = excluded.original_name,
          absolute_path = excluded.absolute_path,
          uploaded_at = excluded.uploaded_at,
          size_bytes = excluded.size_bytes,
          bundle_id = excluded.bundle_id,
          display_name = excluded.display_name,
          version = excluded.version,
          min_ios_version = excluded.min_ios_version,
          entitlements_json = excluded.entitlements_json,
          capabilities_json = excluded.capabilities_json,
          warnings_json = excluded.warnings_json
      `
      )
      .run({
        id: artifact.id,
        filename: artifact.filename,
        original_name: artifact.originalName,
        absolute_path: artifact.absolutePath,
        uploaded_at: artifact.uploadedAt,
        size_bytes: artifact.sizeBytes,
        bundle_id: artifact.bundleId,
        display_name: artifact.displayName,
        version: artifact.version,
        min_ios_version: artifact.minIOSVersion ?? null,
        entitlements_json: JSON.stringify(artifact.entitlements ?? {}),
        capabilities_json: JSON.stringify(artifact.capabilities ?? []),
        warnings_json: JSON.stringify(artifact.warnings ?? [])
      });
  }

  public saveJob(job: InstallJob): void {
    this.jobs.set(job.id, job);

    const tx = this.db.transaction((value: InstallJob) => {
      this.db
        .prepare(
          `
          INSERT INTO jobs (
            id, mode, ipa_id, device_id, status,
            queued_at, started_at, ended_at, error, action,
            command_preview_json, real_execution_approved, helper_ensured
          ) VALUES (
            @id, @mode, @ipa_id, @device_id, @status,
            @queued_at, @started_at, @ended_at, @error, @action,
            @command_preview_json, @real_execution_approved, @helper_ensured
          )
          ON CONFLICT(id) DO UPDATE SET
            mode = excluded.mode,
            ipa_id = excluded.ipa_id,
            device_id = excluded.device_id,
            status = excluded.status,
            queued_at = excluded.queued_at,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            error = excluded.error,
            action = excluded.action,
            command_preview_json = excluded.command_preview_json,
            real_execution_approved = excluded.real_execution_approved,
            helper_ensured = excluded.helper_ensured
        `
        )
        .run({
          id: value.id,
          mode: value.mode,
          ipa_id: value.ipaId,
          device_id: value.deviceId,
          status: value.status,
          queued_at: value.queuedAt,
          started_at: value.startedAt ?? null,
          ended_at: value.endedAt ?? null,
          error: value.error ?? null,
          action: value.action ?? null,
          command_preview_json: JSON.stringify(value.commandPreview ?? []),
          real_execution_approved: value.realExecutionApproved ? 1 : 0,
          helper_ensured: value.helperEnsured ? 1 : 0
        });

      value.steps.forEach((step, index) => {
        this.db
          .prepare(
            `
            INSERT INTO job_steps (
              job_id, step_key, position, label, state,
              started_at, ended_at, detail, action
            ) VALUES (
              @job_id, @step_key, @position, @label, @state,
              @started_at, @ended_at, @detail, @action
            )
            ON CONFLICT(job_id, step_key) DO UPDATE SET
              position = excluded.position,
              label = excluded.label,
              state = excluded.state,
              started_at = excluded.started_at,
              ended_at = excluded.ended_at,
              detail = excluded.detail,
              action = excluded.action
          `
          )
          .run({
            job_id: value.id,
            step_key: step.key,
            position: index,
            label: step.label,
            state: step.state,
            started_at: step.startedAt ?? null,
            ended_at: step.endedAt ?? null,
            detail: step.detail ?? null,
            action: step.action ?? null
          });
      });
    });

    tx(job);
  }

  public saveInstall(record: InstalledAppRecord): void {
    this.installedApps.set(record.id, record);

    this.db
      .prepare(
        `
        INSERT INTO installs (
          id, job_id, ipa_id, device_id, mode,
          kind, label, bundle_id, preferred_transport,
          installed_at, expires_at, last_refresh_at,
          refresh_count, health, auto_refresh_json
        ) VALUES (
          @id, @job_id, @ipa_id, @device_id, @mode,
          @kind, @label, @bundle_id, @preferred_transport,
          @installed_at, @expires_at, @last_refresh_at,
          @refresh_count, @health, @auto_refresh_json
        )
        ON CONFLICT(id) DO UPDATE SET
          job_id = excluded.job_id,
          ipa_id = excluded.ipa_id,
          device_id = excluded.device_id,
          mode = excluded.mode,
          kind = excluded.kind,
          label = excluded.label,
          bundle_id = excluded.bundle_id,
          preferred_transport = excluded.preferred_transport,
          installed_at = excluded.installed_at,
          expires_at = excluded.expires_at,
          last_refresh_at = excluded.last_refresh_at,
          refresh_count = excluded.refresh_count,
          health = excluded.health,
          auto_refresh_json = excluded.auto_refresh_json
      `
      )
      .run({
        id: record.id,
        job_id: record.jobId,
        ipa_id: record.ipaId,
        device_id: record.deviceId,
        mode: record.mode,
        kind: record.kind,
        label: record.label,
        bundle_id: record.bundleId,
        preferred_transport: record.preferredTransport,
        installed_at: record.installedAt,
        expires_at: record.expiresAt,
        last_refresh_at: record.lastRefreshAt ?? null,
        refresh_count: record.refreshCount,
        health: record.health,
        auto_refresh_json: JSON.stringify(record.autoRefresh)
      });
  }

  public saveDeviceSnapshot(mode: RuntimeMode, result: DeviceListResult): void {
    const snapshot: DeviceListResult = {
      ...result,
      requestedMode: mode,
      capturedAt: result.capturedAt ?? new Date().toISOString()
    };

    this.deviceCache.set(mode, snapshot);

    this.db
      .prepare(
        `
        INSERT INTO device_snapshots (
          mode, source, note, devices_json, captured_at
        ) VALUES (
          @mode, @source, @note, @devices_json, @captured_at
        )
        ON CONFLICT(mode) DO UPDATE SET
          source = excluded.source,
          note = excluded.note,
          devices_json = excluded.devices_json,
          captured_at = excluded.captured_at
      `
      )
      .run({
        mode,
        source: snapshot.source,
        note: snapshot.note ?? null,
        devices_json: JSON.stringify(snapshot.devices ?? []),
        captured_at: snapshot.capturedAt
      });
  }

  public getDeviceSnapshot(mode: RuntimeMode): DeviceListResult | undefined {
    return this.deviceCache.get(mode);
  }

  public saveSchedulerState(snapshot: SchedulerSnapshot): void {
    this.schedulerState = snapshot;

    this.db
      .prepare(
        `
        INSERT INTO scheduler_state (
          id, running, simulated_now, tick_interval_ms,
          simulated_hours_per_tick, auto_refresh_threshold_hours,
          wifi_preferred, updated_at
        ) VALUES (
          1, @running, @simulated_now, @tick_interval_ms,
          @simulated_hours_per_tick, @auto_refresh_threshold_hours,
          @wifi_preferred, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          running = excluded.running,
          simulated_now = excluded.simulated_now,
          tick_interval_ms = excluded.tick_interval_ms,
          simulated_hours_per_tick = excluded.simulated_hours_per_tick,
          auto_refresh_threshold_hours = excluded.auto_refresh_threshold_hours,
          wifi_preferred = excluded.wifi_preferred,
          updated_at = excluded.updated_at
      `
      )
      .run({
        running: snapshot.running ? 1 : 0,
        simulated_now: snapshot.simulatedNow,
        tick_interval_ms: snapshot.tickIntervalMs,
        simulated_hours_per_tick: snapshot.simulatedHoursPerTick,
        auto_refresh_threshold_hours: snapshot.autoRefreshThresholdHours,
        wifi_preferred: snapshot.wifiPreferred ? 1 : 0,
        updated_at: new Date().toISOString()
      });
  }

  public getSchedulerState(defaults: SchedulerSnapshot): SchedulerSnapshot {
    if (this.schedulerState) {
      return {
        ...this.schedulerState,
        tickIntervalMs: defaults.tickIntervalMs,
        simulatedHoursPerTick: defaults.simulatedHoursPerTick,
        autoRefreshThresholdHours: defaults.autoRefreshThresholdHours,
        wifiPreferred: defaults.wifiPreferred
      };
    }

    return defaults;
  }

  public appendLog(entry: LogEntry, maxEntries: number): void {
    this.db
      .prepare(
        `
        INSERT INTO logs (id, at, level, code, message, action, context_json)
        VALUES (@id, @at, @level, @code, @message, @action, @context_json)
      `
      )
      .run({
        id: entry.id,
        at: entry.at,
        level: entry.level,
        code: entry.code,
        message: entry.message,
        action: entry.action ?? null,
        context_json: entry.context ? JSON.stringify(entry.context) : null
      });

    this.db
      .prepare(
        `
        DELETE FROM logs
        WHERE id NOT IN (
          SELECT id FROM logs ORDER BY at DESC LIMIT ?
        )
      `
      )
      .run(maxEntries);
  }

  public listLogs(limit: number): LogEntry[] {
    const rows = this.db
      .prepare(
        `
        SELECT id, at, level, code, message, action, context_json
        FROM logs
        ORDER BY at DESC
        LIMIT ?
      `
      )
      .all(limit) as Array<{
      id: string;
      at: string;
      level: LogEntry['level'];
      code: string;
      message: string;
      action: string | null;
      context_json: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      level: row.level,
      code: row.code,
      message: row.message,
      action: asOptionalString(row.action),
      context: parseJson<Record<string, unknown> | undefined>(row.context_json, undefined)
    }));
  }

  public clearLogs(): void {
    this.db.prepare('DELETE FROM logs').run();
  }

  public saveJobCommandRun(run: JobCommandRun): void {
    this.db
      .prepare(
        `
        INSERT INTO job_command_runs (
          id, job_id, step_key, command, args_json,
          cwd, started_at, ended_at, exit_code, status,
          stdout, stderr, note
        ) VALUES (
          @id, @job_id, @step_key, @command, @args_json,
          @cwd, @started_at, @ended_at, @exit_code, @status,
          @stdout, @stderr, @note
        )
      `
      )
      .run({
        id: run.id,
        job_id: run.jobId,
        step_key: run.stepKey,
        command: run.command,
        args_json: JSON.stringify(run.args ?? []),
        cwd: run.cwd ?? null,
        started_at: run.startedAt,
        ended_at: run.endedAt,
        exit_code: run.exitCode ?? null,
        status: run.status,
        stdout: run.stdout ?? null,
        stderr: run.stderr ?? null,
        note: run.note ?? null
      });
  }

  public listJobCommandRuns(jobId: string, limit = 200): JobCommandRun[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          id, job_id, step_key, command, args_json,
          cwd, started_at, ended_at, exit_code, status,
          stdout, stderr, note
        FROM job_command_runs
        WHERE job_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `
      )
      .all(jobId, limit) as Array<{
      id: string;
      job_id: string;
      step_key: string;
      command: string;
      args_json: string;
      cwd: string | null;
      started_at: string;
      ended_at: string;
      exit_code: number | null;
      status: JobCommandRun['status'];
      stdout: string | null;
      stderr: string | null;
      note: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      stepKey: row.step_key,
      command: row.command,
      args: parseJson<string[]>(row.args_json, []),
      cwd: asOptionalString(row.cwd),
      startedAt: row.started_at,
      endedAt: row.ended_at,
      exitCode: row.exit_code ?? undefined,
      status: row.status,
      stdout: asOptionalString(row.stdout),
      stderr: asOptionalString(row.stderr),
      note: asOptionalString(row.note)
    }));
  }

  public countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    return row.count;
  }

  public getUserByUsername(username: string): UserRecord | undefined {
    const row = this.db
      .prepare(
        `
        SELECT id, username, password_hash, role, created_at, updated_at, last_login_at
        FROM users
        WHERE username = ?
        LIMIT 1
      `
      )
      .get(username) as
      | {
          id: string;
          username: string;
          password_hash: string;
          role: UserRecord['role'];
          created_at: string;
          updated_at: string;
          last_login_at: string | null;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: asOptionalString(row.last_login_at)
    };
  }

  public getUserById(id: string): UserRecord | undefined {
    const row = this.db
      .prepare(
        `
        SELECT id, username, password_hash, role, created_at, updated_at, last_login_at
        FROM users
        WHERE id = ?
        LIMIT 1
      `
      )
      .get(id) as
      | {
          id: string;
          username: string;
          password_hash: string;
          role: UserRecord['role'];
          created_at: string;
          updated_at: string;
          last_login_at: string | null;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: asOptionalString(row.last_login_at)
    };
  }

  public saveUser(user: UserRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO users (
          id, username, password_hash, role,
          created_at, updated_at, last_login_at
        ) VALUES (
          @id, @username, @password_hash, @role,
          @created_at, @updated_at, @last_login_at
        )
        ON CONFLICT(id) DO UPDATE SET
          username = excluded.username,
          password_hash = excluded.password_hash,
          role = excluded.role,
          updated_at = excluded.updated_at,
          last_login_at = excluded.last_login_at
      `
      )
      .run({
        id: user.id,
        username: user.username,
        password_hash: user.passwordHash,
        role: user.role,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
        last_login_at: user.lastLoginAt ?? null
      });
  }

  public saveSession(session: UserSessionRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO sessions (
          id, user_id, token_hash, created_at,
          expires_at, revoked_at, user_agent, ip_address
        ) VALUES (
          @id, @user_id, @token_hash, @created_at,
          @expires_at, @revoked_at, @user_agent, @ip_address
        )
      `
      )
      .run({
        id: session.id,
        user_id: session.userId,
        token_hash: session.tokenHash,
        created_at: session.createdAt,
        expires_at: session.expiresAt,
        revoked_at: session.revokedAt ?? null,
        user_agent: session.userAgent ?? null,
        ip_address: session.ipAddress ?? null
      });
  }

  public getActiveSessionByTokenHash(tokenHash: string, nowIso: string): UserSessionRecord | undefined {
    const row = this.db
      .prepare(
        `
        SELECT id, user_id, token_hash, created_at, expires_at, revoked_at, user_agent, ip_address
        FROM sessions
        WHERE token_hash = ?
          AND revoked_at IS NULL
          AND expires_at > ?
        LIMIT 1
      `
      )
      .get(tokenHash, nowIso) as
      | {
          id: string;
          user_id: string;
          token_hash: string;
          created_at: string;
          expires_at: string;
          revoked_at: string | null;
          user_agent: string | null;
          ip_address: string | null;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: asOptionalString(row.revoked_at),
      userAgent: asOptionalString(row.user_agent),
      ipAddress: asOptionalString(row.ip_address)
    };
  }

  public revokeSession(sessionId: string, revokedAt: string): void {
    this.db
      .prepare(
        `
        UPDATE sessions
        SET revoked_at = ?
        WHERE id = ?
      `
      )
      .run(revokedAt, sessionId);
  }

  public purgeExpiredSessions(nowIso: string): void {
    this.db
      .prepare(
        `
        DELETE FROM sessions
        WHERE expires_at <= ?
      `
      )
      .run(nowIso);
  }

  public pruneActiveSessions(userId: string, keepMostRecent: number): void {
    this.db
      .prepare(
        `
        UPDATE sessions
        SET revoked_at = ?
        WHERE id IN (
          SELECT id FROM sessions
          WHERE user_id = ?
            AND revoked_at IS NULL
          ORDER BY created_at DESC
          LIMIT -1 OFFSET ?
        )
      `
      )
      .run(new Date().toISOString(), userId, keepMostRecent);
  }

  public getAuthAttempt(key: string): AuthAttemptRecord | undefined {
    const row = this.db
      .prepare(
        `
        SELECT key, username, failed_count, first_failed_at, lock_until
        FROM auth_attempts
        WHERE key = ?
        LIMIT 1
      `
      )
      .get(key) as
      | {
          key: string;
          username: string;
          failed_count: number;
          first_failed_at: number;
          lock_until: number | null;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      key: row.key,
      username: row.username,
      count: row.failed_count,
      firstFailedAt: row.first_failed_at,
      lockUntil: row.lock_until ?? undefined
    };
  }

  public saveAuthAttempt(attempt: AuthAttemptRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO auth_attempts (
          key, username, failed_count, first_failed_at, lock_until, updated_at
        ) VALUES (
          @key, @username, @failed_count, @first_failed_at, @lock_until, @updated_at
        )
        ON CONFLICT(key) DO UPDATE SET
          username = excluded.username,
          failed_count = excluded.failed_count,
          first_failed_at = excluded.first_failed_at,
          lock_until = excluded.lock_until,
          updated_at = excluded.updated_at
      `
      )
      .run({
        key: attempt.key,
        username: attempt.username,
        failed_count: attempt.count,
        first_failed_at: attempt.firstFailedAt,
        lock_until: attempt.lockUntil ?? null,
        updated_at: new Date().toISOString()
      });
  }

  public deleteAuthAttempt(key: string): void {
    this.db.prepare('DELETE FROM auth_attempts WHERE key = ?').run(key);
  }

  public purgeStaleAuthAttempts(olderThanEpochMs: number): void {
    this.db
      .prepare(
        `
        DELETE FROM auth_attempts
        WHERE lock_until IS NULL
          AND first_failed_at < ?
      `
      )
      .run(olderThanEpochMs);
  }

  public setSettingValue(key: string, value: string): void {
    this.setSetting(key, value);
  }

  public getSettingValue(key: string): string | undefined {
    return this.getSetting(key);
  }

  private setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
      )
      .run(key, value, new Date().toISOString());
  }

  private getSetting(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ? LIMIT 1')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  private load(defaultMode: RuntimeMode): void {
    const savedMode = asOptionalString(this.getSetting('runtime_mode'));
    this.mode = asRuntimeMode(savedMode, defaultMode);
    this.setSetting('runtime_mode', this.mode);

    const ipaRows = this.db
      .prepare(
        `
        SELECT
          id, filename, original_name, absolute_path, uploaded_at, size_bytes,
          bundle_id, display_name, version, min_ios_version,
          entitlements_json, capabilities_json, warnings_json
        FROM ipas
      `
      )
      .all() as Array<{
      id: string;
      filename: string;
      original_name: string;
      absolute_path: string;
      uploaded_at: string;
      size_bytes: number;
      bundle_id: string;
      display_name: string;
      version: string;
      min_ios_version: string | null;
      entitlements_json: string;
      capabilities_json: string;
      warnings_json: string;
    }>;

    ipaRows.forEach((row) => {
      this.ipas.set(row.id, {
        id: row.id,
        filename: row.filename,
        originalName: row.original_name,
        absolutePath: row.absolute_path,
        uploadedAt: row.uploaded_at,
        sizeBytes: row.size_bytes,
        bundleId: row.bundle_id,
        displayName: row.display_name,
        version: row.version,
        minIOSVersion: asOptionalString(row.min_ios_version),
        entitlements: parseJson<Record<string, unknown>>(row.entitlements_json, {}),
        capabilities: parseJson<string[]>(row.capabilities_json, []),
        warnings: parseJson<string[]>(row.warnings_json, [])
      });
    });

    const jobRows = this.db
      .prepare(
        `
        SELECT
          id, mode, ipa_id, device_id, status,
          queued_at, started_at, ended_at, error, action,
          command_preview_json, real_execution_approved, helper_ensured
        FROM jobs
      `
      )
      .all() as Array<{
      id: string;
      mode: RuntimeMode;
      ipa_id: string;
      device_id: string;
      status: InstallJob['status'];
      queued_at: string;
      started_at: string | null;
      ended_at: string | null;
      error: string | null;
      action: string | null;
      command_preview_json: string | null;
      real_execution_approved: number;
      helper_ensured: number | null;
    }>;

    const stepStatement = this.db.prepare(
      `
      SELECT
        step_key, label, state,
        started_at, ended_at, detail, action
      FROM job_steps
      WHERE job_id = ?
      ORDER BY position ASC
    `
    );

    jobRows.forEach((row) => {
      const steps = stepStatement.all(row.id) as Array<{
        step_key: string;
        label: string;
        state: InstallJob['steps'][number]['state'];
        started_at: string | null;
        ended_at: string | null;
        detail: string | null;
        action: string | null;
      }>;

      this.jobs.set(row.id, {
        id: row.id,
        mode: row.mode,
        ipaId: row.ipa_id,
        deviceId: row.device_id,
        status: row.status,
        queuedAt: row.queued_at,
        startedAt: asOptionalString(row.started_at),
        endedAt: asOptionalString(row.ended_at),
        error: asOptionalString(row.error),
        action: asOptionalString(row.action),
        commandPreview: parseJson<string[]>(row.command_preview_json, []),
        realExecutionApproved: row.real_execution_approved === 1,
        helperEnsured: (row.helper_ensured ?? 0) === 1,
        steps: steps.map((step) => ({
          key: step.step_key,
          label: step.label,
          state: step.state,
          startedAt: asOptionalString(step.started_at),
          endedAt: asOptionalString(step.ended_at),
          detail: asOptionalString(step.detail),
          action: asOptionalString(step.action)
        }))
      });
    });

    const installRows = this.db
      .prepare(
        `
        SELECT
          id, job_id, ipa_id, device_id, mode,
          kind, label, bundle_id, preferred_transport,
          installed_at, expires_at, last_refresh_at,
          refresh_count, health, auto_refresh_json
        FROM installs
      `
      )
      .all() as Array<{
      id: string;
      job_id: string;
      ipa_id: string;
      device_id: string;
      mode: RuntimeMode;
      kind: InstalledAppRecord['kind'] | null;
      label: string | null;
      bundle_id: string | null;
      preferred_transport: InstalledAppRecord['preferredTransport'] | null;
      installed_at: string;
      expires_at: string;
      last_refresh_at: string | null;
      refresh_count: number;
      health: InstalledAppRecord['health'];
      auto_refresh_json: string | null;
    }>;

    installRows.forEach((row) => {
      const fallbackNextAttemptAt = row.expires_at;
      this.installedApps.set(row.id, {
        id: row.id,
        jobId: row.job_id,
        ipaId: row.ipa_id,
        deviceId: row.device_id,
        mode: row.mode,
        kind: row.kind ?? 'primary',
        label: asOptionalString(row.label) ?? row.ipa_id,
        bundleId: asOptionalString(row.bundle_id) ?? row.ipa_id,
        preferredTransport: row.preferred_transport ?? 'wifi',
        installedAt: row.installed_at,
        expiresAt: row.expires_at,
        lastRefreshAt: asOptionalString(row.last_refresh_at),
        refreshCount: row.refresh_count,
        health: row.health,
        autoRefresh: parseJson(row.auto_refresh_json, {
          policy: 'wifi-preferred',
          thresholdHours: 48,
          nextAttemptAt: fallbackNextAttemptAt,
          retryCount: 0,
          backoffMinutes: 0,
          nextAttemptReason: 'Waiting for 48h pre-expiry auto-refresh window.',
          lastDecisionCode: 'AUTO_REFRESH_WINDOW_PENDING'
        })
      });
    });

    const snapshotRows = this.db
      .prepare(
        `
        SELECT mode, source, note, devices_json, captured_at
        FROM device_snapshots
      `
      )
      .all() as Array<{
      mode: RuntimeMode;
      source: DeviceListResult['source'];
      note: string | null;
      devices_json: string;
      captured_at: string;
    }>;

    snapshotRows.forEach((row) => {
      this.deviceCache.set(row.mode, {
        requestedMode: row.mode,
        source: row.source,
        note: asOptionalString(row.note),
        devices: parseJson<DeviceListResult['devices']>(row.devices_json, []),
        capturedAt: row.captured_at
      });
    });

    const schedulerRow = this.db
      .prepare(
        `
        SELECT
          running,
          simulated_now,
          tick_interval_ms,
          simulated_hours_per_tick,
          auto_refresh_threshold_hours,
          wifi_preferred
        FROM scheduler_state
        WHERE id = 1
      `
      )
      .get() as
      | {
          running: number;
          simulated_now: string;
          tick_interval_ms: number;
          simulated_hours_per_tick: number;
          auto_refresh_threshold_hours: number | null;
          wifi_preferred: number | null;
        }
      | undefined;

    if (schedulerRow) {
      this.schedulerState = {
        running: schedulerRow.running === 1,
        simulatedNow: schedulerRow.simulated_now,
        tickIntervalMs: schedulerRow.tick_interval_ms,
        simulatedHoursPerTick: schedulerRow.simulated_hours_per_tick,
        autoRefreshThresholdHours: schedulerRow.auto_refresh_threshold_hours ?? 48,
        wifiPreferred: (schedulerRow.wifi_preferred ?? 1) === 1
      };
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ipas (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        absolute_path TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        bundle_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        version TEXT NOT NULL,
        min_ios_version TEXT,
        entitlements_json TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS device_snapshots (
        mode TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        note TEXT,
        devices_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        ipa_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        status TEXT NOT NULL,
        queued_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        error TEXT,
        action TEXT,
        command_preview_json TEXT,
        real_execution_approved INTEGER NOT NULL DEFAULT 0,
        helper_ensured INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS job_steps (
        job_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        label TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        detail TEXT,
        action TEXT,
        PRIMARY KEY (job_id, step_key),
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS job_command_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        cwd TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        exit_code INTEGER,
        status TEXT NOT NULL,
        stdout TEXT,
        stderr TEXT,
        note TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_job_command_runs_job ON job_command_runs(job_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS installs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        ipa_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'primary',
        label TEXT,
        bundle_id TEXT,
        preferred_transport TEXT NOT NULL DEFAULT 'wifi',
        installed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_refresh_at TEXT,
        refresh_count INTEGER NOT NULL,
        health TEXT NOT NULL,
        auto_refresh_json TEXT
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        level TEXT NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        action TEXT,
        context_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_logs_at ON logs(at DESC);

      CREATE TABLE IF NOT EXISTS scheduler_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        running INTEGER NOT NULL,
        simulated_now TEXT NOT NULL,
        tick_interval_ms INTEGER NOT NULL,
        simulated_hours_per_tick REAL NOT NULL,
        auto_refresh_threshold_hours REAL NOT NULL DEFAULT 48,
        wifi_preferred INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        user_agent TEXT,
        ip_address TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS auth_attempts (
        key TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        failed_count INTEGER NOT NULL,
        first_failed_at INTEGER NOT NULL,
        lock_until INTEGER,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auth_attempts_updated_at ON auth_attempts(updated_at DESC);
    `);

    this.ensureColumn('jobs', 'helper_ensured', "ALTER TABLE jobs ADD COLUMN helper_ensured INTEGER NOT NULL DEFAULT 0");

    this.ensureColumn('installs', 'kind', "ALTER TABLE installs ADD COLUMN kind TEXT NOT NULL DEFAULT 'primary'");
    this.ensureColumn('installs', 'label', 'ALTER TABLE installs ADD COLUMN label TEXT');
    this.ensureColumn('installs', 'bundle_id', 'ALTER TABLE installs ADD COLUMN bundle_id TEXT');
    this.ensureColumn('installs', 'preferred_transport', "ALTER TABLE installs ADD COLUMN preferred_transport TEXT NOT NULL DEFAULT 'wifi'");
    this.ensureColumn('installs', 'auto_refresh_json', 'ALTER TABLE installs ADD COLUMN auto_refresh_json TEXT');

    this.ensureColumn(
      'scheduler_state',
      'auto_refresh_threshold_hours',
      'ALTER TABLE scheduler_state ADD COLUMN auto_refresh_threshold_hours REAL NOT NULL DEFAULT 48'
    );
    this.ensureColumn(
      'scheduler_state',
      'wifi_preferred',
      'ALTER TABLE scheduler_state ADD COLUMN wifi_preferred INTEGER NOT NULL DEFAULT 1'
    );
  }

  private ensureColumn(table: string, column: string, sql: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!rows.some((row) => row.name === column)) {
      this.db.exec(sql);
    }
  }
}

