// ─── Install Pipeline ────────────────────────────────────────────────
// The 6-step pipeline that takes an IPA from upload to installed on device:
//   1. validate  — verify IPA exists, parse metadata
//   2. authenticate — ensure Apple account session is valid
//   3. provision — register device, create App ID, cert, profile
//   4. sign — re-sign IPA with the new provisioning assets
//   5. install — push signed IPA to device via pymobiledevice3
//   6. register — record in installed_apps for refresh tracking
//
// Features:
//   • Per-device mutex (only one install per device at a time)
//   • Each step updates job status in real-time (for SSE)
//   • Full crash recovery: incomplete jobs marked failed on startup
//   • Command audit trail for every shell command

import { randomUUID } from 'node:crypto';
import type { Database } from '../state/database';
import type { LogService } from '../services/log-service';
import type { AppleAccountService } from '../services/apple-account-service';
import type { ProvisioningService } from '../services/provisioning-service';
import type { DeviceService } from '../services/device-service';
import type { IpaService } from '../services/ipa-service';
import type { EncryptionProvider } from '../types';
import { signIpa } from '../signing';
import type {
  InstallJob,
  PipelineStep,
  PipelineStepName,
  IpaArtifact,
  AppleAccount,
  JobStatus,
  JobLogEntry,
  LogLevel,
} from '../../shared/types';
import { PIPELINE_STEPS, LOG_CODES } from '../../shared/constants';
import { PipelineError, DeviceError, SigningError, Apple2FARequiredError } from '../utils/errors';

// ─── Per-device Mutex ────────────────────────────────────────────────

type MutexRelease = () => void;
const deviceLocks = new Map<string, Promise<void>>();

async function acquireDeviceLock(udid: string): Promise<MutexRelease> {
  // Chain on the existing lock promise to serialize access per device
  const prev = deviceLocks.get(udid) ?? Promise.resolve();
  let release!: MutexRelease;
  const next = new Promise<void>(resolve => { release = resolve; });
  // Immediately install our promise so the next caller waits on us
  deviceLocks.set(udid, next);
  // Wait for the previous holder to finish
  await prev;
  return () => {
    // Only delete if we're still the latest lock in the chain
    if (deviceLocks.get(udid) === next) deviceLocks.delete(udid);
    release();
  };
}

// ─── Event Emitter for Pipeline Progress ─────────────────────────────

type PipelineListener = (job: InstallJob) => void;
const listeners: PipelineListener[] = [];
type PipelineJobLogListener = (entry: JobLogEntry) => void;
const logListeners: PipelineJobLogListener[] = [];
const jobLogs = new Map<string, JobLogEntry[]>();
const MAX_JOB_LOG_LINES = 300;

export function onPipelineUpdate(listener: PipelineListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function notifyListeners(job: InstallJob): void {
  for (const listener of listeners) {
    try { listener(job); } catch (err) {
      console.warn('[pipeline] Listener error:', err);
    }
  }
}

export function onPipelineJobLog(listener: PipelineJobLogListener): () => void {
  logListeners.push(listener);
  return () => {
    const idx = logListeners.indexOf(listener);
    if (idx >= 0) logListeners.splice(idx, 1);
  };
}

export function getJobLogs(jobId: string): JobLogEntry[] {
  return [...(jobLogs.get(jobId) ?? [])];
}

function appendJobLog(entry: JobLogEntry): void {
  const entries = jobLogs.get(entry.jobId) ?? [];
  entries.push(entry);
  if (entries.length > MAX_JOB_LOG_LINES) {
    entries.splice(0, entries.length - MAX_JOB_LOG_LINES);
  }
  jobLogs.set(entry.jobId, entries);
  for (const listener of logListeners) {
    try {
      listener(entry);
    } catch (err) {
      console.warn('[pipeline] Job log listener error:', err);
    }
  }
}

function logJobLine(
  job: InstallJob,
  level: LogLevel,
  message: string,
  step: PipelineStepName | null,
  meta?: Record<string, unknown>,
): void {
  appendJobLog({
    id: randomUUID(),
    jobId: job.id,
    step,
    level,
    message,
    meta: meta ?? null,
    at: new Date().toISOString(),
  });
}

// ─── 2FA Pause / Resume ─────────────────────────────────────────────

const TWO_FA_TIMEOUT_MS = 5 * 60_000; // 5 minutes

interface TwoFAWaiter {
  resolve: (code: string) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending2FA = new Map<string, TwoFAWaiter>();

/**
 * Submit a 2FA code for a waiting pipeline job.
 * Returns true if the job was waiting and the code was delivered.
 */
export function submitJobTwoFA(jobId: string, code: string): boolean {
  const waiter = pending2FA.get(jobId);
  if (!waiter) return false;
  clearTimeout(waiter.timer);
  pending2FA.delete(jobId);
  waiter.resolve(code);
  return true;
}

/**
 * Check whether a job is currently waiting for 2FA.
 */
export function isJobWaitingFor2FA(jobId: string): boolean {
  return pending2FA.has(jobId);
}

/**
 * Internal: create a promise that resolves when a 2FA code is submitted
 * or rejects after timeout.
 */
function waitFor2FACode(jobId: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending2FA.delete(jobId);
      reject(new PipelineError('TWO_FA_TIMEOUT', '2FA code was not submitted within 5 minutes'));
    }, TWO_FA_TIMEOUT_MS);

    pending2FA.set(jobId, { resolve, reject, timer });
  });
}

// ─── Pipeline Orchestrator ───────────────────────────────────────────

export interface PipelineDeps {
  db: Database;
  logs: LogService;
  accounts: AppleAccountService;
  provisioning: ProvisioningService;
  devices: DeviceService;
  ipas: IpaService;
  encryption: EncryptionProvider;
}

/**
 * Start a new install pipeline job.
 */
export async function startInstallPipeline(
  deps: PipelineDeps,
  params: {
    accountId: string;
    ipaId: string;
    deviceUdid: string;
    includeExtensions?: boolean;
  },
): Promise<InstallJob> {
  const { db, logs, accounts, provisioning, devices, ipas, encryption } = deps;

  // Create job record
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job: InstallJob = {
    id: jobId,
    accountId: params.accountId,
    ipaId: params.ipaId,
    deviceUdid: params.deviceUdid,
    includeExtensions: params.includeExtensions ?? false,
    status: 'queued',
    currentStep: null,
    steps: PIPELINE_STEPS.map(step => ({
      name: step.key as PipelineStep['name'],
      status: 'pending' as const,
      startedAt: null,
      completedAt: null,
      error: null,
    })),
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  db.createJob(job);
  notifyListeners(job);
  logJobLine(job, 'info', 'Job queued', null, {
    accountId: params.accountId,
    ipaId: params.ipaId,
    deviceUdid: params.deviceUdid,
    includeExtensions: params.includeExtensions ?? false,
  });
  logs.info(LOG_CODES.JOB_STARTED, `Pipeline started: ${jobId}`, {
    jobId, accountId: params.accountId, ipaId: params.ipaId, deviceUdid: params.deviceUdid,
  });

  // Run asynchronously with per-device lock
  runPipeline(deps, job).catch(error => {
    logs.error(LOG_CODES.JOB_FAILED, `Pipeline crashed: ${jobId}`, {
      jobId, error: String(error),
    });
  });

  return job;
}

/**
 * Get the current state of a job.
 */
export function getJob(db: Database, jobId: string): InstallJob | null {
  return db.getJob(jobId) ?? null;
}

/**
 * List all jobs, optionally filtered.
 */
export function listJobs(db: Database, filters?: {
  accountId?: string;
  deviceUdid?: string;
  status?: string;
}): InstallJob[] {
  return db.listJobs(filters);
}

/**
 * Mark any in-progress jobs as failed (crash recovery on startup).
 */
export function recoverStalledJobs(db: Database, logs: LogService): number {
  const running = db.listJobs({ status: 'running' });
  const waiting = db.listJobs({ status: 'waiting_2fa' });
  const stalled = [...running, ...waiting];
  let count = 0;
  for (const job of stalled) {
    job.status = 'failed';
    job.error = 'Server restarted during pipeline execution';
    job.updatedAt = new Date().toISOString();
    for (const step of job.steps) {
      if (step.status === 'running') {
        step.status = 'failed';
        step.error = 'Interrupted by server restart';
        step.completedAt = job.updatedAt;
      }
    }
    db.updateJob(job);
    count++;
  }
  if (count > 0) {
    logs.warn(LOG_CODES.JOB_RECOVERED, `Recovered ${count} stalled jobs`, { count });
  }
  return count;
}

// ─── Pipeline Steps ──────────────────────────────────────────────────

async function runPipeline(deps: PipelineDeps, job: InstallJob): Promise<void> {
  const { db, logs, accounts, provisioning, devices, ipas, encryption } = deps;
  const release = await acquireDeviceLock(job.deviceUdid);

  // Signing cleanup callback — must be declared outside try/finally scope
  let signingCleanup: (() => Promise<void>) | undefined;

  try {
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    db.updateJob(job);
    notifyListeners(job);
    logJobLine(job, 'info', `Acquired device lock for ${job.deviceUdid}`, null, { deviceUdid: job.deviceUdid });

    // Context accumulated through the pipeline
    let ipa: IpaArtifact | undefined;
    let account: AppleAccount | undefined;
    let provisionResult: any;
    let signedIpaPath: string | undefined;

    // ── Step 1: Validate ──────────────────────────────────────────
    await runStep(db, job, 'validate', async () => {
      ipa = ipas.get(job.ipaId) ?? undefined;
      if (!ipa) throw new PipelineError('IPA_NOT_FOUND', 'IPA not found');

      const device = devices.get(job.deviceUdid);
      if (!device) throw new DeviceError('DEVICE_NOT_CONNECTED', 'Device not connected');
    });

    // ── Step 2: Authenticate ──────────────────────────────────────
    await runStep(db, job, 'authenticate', async () => {
      account = accounts.get(job.accountId) ?? undefined;
      if (!account) throw new PipelineError('ACCOUNT_NOT_FOUND', 'Apple account not found');

      try {
        // Refresh session — returns cached session if recent, otherwise re-authenticates.
        await accounts.refreshAuth(job.accountId);
        account = accounts.get(job.accountId) ?? undefined;
      } catch (error) {
        if (!(error instanceof Apple2FARequiredError)) throw error;

        // ── 2FA Required – pause pipeline and wait for user input ──
        job.status = 'waiting_2fa' as JobStatus;
        job.updatedAt = new Date().toISOString();
        db.updateJob(job);
        notifyListeners(job);
        logJobLine(job, 'warn', 'Waiting for 2FA code', 'authenticate', { timeoutMs: TWO_FA_TIMEOUT_MS });
        logs.info(LOG_CODES.JOB_WAITING_2FA, `Waiting for 2FA code: ${job.id}`, { jobId: job.id });

        const code = await waitFor2FACode(job.id);

        // Submit 2FA and complete authentication
        await accounts.complete2FAForAccount(job.accountId, code);
        account = accounts.get(job.accountId) ?? undefined;

        // Resume pipeline
        job.status = 'running';
        job.updatedAt = new Date().toISOString();
        db.updateJob(job);
        notifyListeners(job);
        logJobLine(job, 'info', '2FA accepted, resuming pipeline', 'authenticate');
        logs.info(LOG_CODES.APPLE_AUTH_2FA_SUBMITTED, `2FA accepted, pipeline resuming: ${job.id}`, { jobId: job.id });
      }
    });

    // ── Step 3: Provision ─────────────────────────────────────────
    await runStep(db, job, 'provision', async () => {
      if (!account || !ipa) throw new PipelineError('MISSING_CONTEXT', 'Missing context');

      const devClient = await accounts.getDevClient(job.accountId);

      // Only pass extension bundle IDs if the user opted in
      const extensionBundleIds = job.includeExtensions
        ? (ipa.extensions ?? []).map(e => e.bundleId)
        : [];

      provisionResult = await provisioning.provision(
        devClient,
        account,
        job.deviceUdid,
        devices.get(job.deviceUdid)?.name ?? 'Unknown Device',
        ipa.bundleId,
        ipa.bundleName,
        extensionBundleIds,
      );
    });

    // ── Step 4: Sign ──────────────────────────────────────────────
    await runStep(db, job, 'sign', async () => {
      if (!provisionResult || !ipa) throw new PipelineError('MISSING_CONTEXT', 'Missing context');

      // CertificateRecord.privateKeyPem is already decrypted by DB layer
      const privateKeyPem = provisionResult.certificate.privateKeyPem;
      if (!privateKeyPem) throw new SigningError('DECRYPT_FAILED', 'Failed to retrieve signing key');

      const signingResult = await signIpa({
        ipaPath: ipa!.filePath,
        provisioningProfileData: Buffer.from(provisionResult.profile.profileData, 'base64'),
        certificatePem: provisionResult.certificate.certificatePem,
        privateKeyPem,
        targetBundleId: provisionResult.effectiveBundleId,
        teamId: account!.teamId,
        includeExtensions: job.includeExtensions,
        extensionProfiles: job.includeExtensions
          ? provisionResult.extensionProfiles.map((ep: any) => ({
              bundleId: ep.effectiveBundleId,
              profileData: Buffer.from(ep.profile.profileData, 'base64'),
            }))
          : [],
      });

      signedIpaPath = signingResult.signedIpaPath;
      signingCleanup = signingResult.cleanup;

      logs.info(LOG_CODES.APP_SIGNED, `IPA signed: ${ipa!.bundleName}`, {
        jobId: job.id, signedIpaPath,
      });
    });

    // ── Step 5: Install ───────────────────────────────────────────
    await runStep(db, job, 'install', async () => {
      if (!signedIpaPath) throw new PipelineError('NO_SIGNED_IPA', 'No signed IPA');

      await devices.installApp(job.deviceUdid, signedIpaPath!);

      logs.info(LOG_CODES.APP_INSTALLED, `App installed on ${job.deviceUdid}`, {
        jobId: job.id, deviceUdid: job.deviceUdid,
      });
    });

    // ── Step 6: Register ──────────────────────────────────────────
    await runStep(db, job, 'register', async () => {
      if (!ipa || !account || !provisionResult) throw new PipelineError('MISSING_CONTEXT', 'Missing context');

      const expiresAt = provisionResult.profile.expiresAt;
      db.upsertInstalledApp({
        accountId: job.accountId,
        deviceUdid: job.deviceUdid,
        bundleId: provisionResult.effectiveBundleId,
        originalBundleId: ipa!.bundleId,
        appName: ipa!.bundleName,
        appVersion: ipa!.bundleVersion ?? 'unknown',
        ipaId: job.ipaId,
        profileId: provisionResult.profile.id,
        certificateId: provisionResult.certificate.id,
        signedIpaPath: signedIpaPath!,
        expiresAt,
        installedAt: new Date().toISOString(),
      });
    });

    // ── All Done ──────────────────────────────────────────────────
    job.status = 'completed';
    job.updatedAt = new Date().toISOString();
    db.updateJob(job);
    notifyListeners(job);
    logJobLine(job, 'info', 'Pipeline completed successfully', null);

    logs.info(LOG_CODES.JOB_COMPLETED, `Pipeline completed: ${job.id}`, {
      jobId: job.id,
    });
  } catch (error) {
    // Step-level errors are already handled in runStep;
    // this catches unexpected errors outside the step flow.
    if (job.status !== 'failed') {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      job.updatedAt = new Date().toISOString();
      db.updateJob(job);
      notifyListeners(job);
      logJobLine(job, 'error', job.error, (job.currentStep as PipelineStepName | null) ?? null);
    }

    logs.error(LOG_CODES.JOB_FAILED, `Pipeline failed: ${job.id}`, {
      jobId: job.id, error: String(error),
    });
  } finally {
    // Clean up signing temp files (workDir, signed IPA, etc.)
    if (signingCleanup) {
      signingCleanup().catch(() => {});
    }
    logJobLine(job, 'debug', `Released device lock for ${job.deviceUdid}`, null, { deviceUdid: job.deviceUdid });
    release();
  }
}

async function runStep(
  db: Database,
  job: InstallJob,
  stepName: PipelineStepName,
  fn: () => Promise<void>,
): Promise<void> {
  const step = job.steps.find(s => s.name === stepName);
  if (!step) throw new PipelineError('UNKNOWN_STEP', `Unknown step: ${stepName}`);

  step.status = 'running';
  step.startedAt = new Date().toISOString();
  job.currentStep = stepName;
  job.updatedAt = step.startedAt;
  db.updateJob(job);
  notifyListeners(job);
  logJobLine(job, 'info', `Starting step: ${stepName}`, stepName);

  try {
    await fn();
    step.status = 'completed';
    step.completedAt = new Date().toISOString();
    job.updatedAt = step.completedAt;
    db.updateJob(job);
    notifyListeners(job);
    logJobLine(job, 'info', `Completed step: ${stepName}`, stepName);
  } catch (error) {
    step.status = 'failed';
    step.error = error instanceof Error ? error.message : String(error);
    step.completedAt = new Date().toISOString();
    job.status = 'failed';
    job.error = step.error;
    job.updatedAt = step.completedAt;
    db.updateJob(job);
    notifyListeners(job);
    logJobLine(job, 'error', `Failed step: ${stepName} - ${step.error}`, stepName);
    throw error; // Re-throw to stop pipeline
  }
}
