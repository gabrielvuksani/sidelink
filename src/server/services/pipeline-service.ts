import { AppStore } from '../state/store';
import { DeviceService } from './device-service';
import { IpaService } from './ipa-service';
import { LogService } from './log-service';
import { SchedulerService } from './scheduler-service';
import { AppError } from '../utils/errors';
import { InstallJob, InstallJobStep, RuntimeMode } from '../types';
import { hoursBetween, sleep } from '../utils/time';
import { RealSigningAdapter, SigningAdapter, SigningExecutionResult } from '../adapters/signing-adapter';
import { InstallAdapter, RealInstallAdapter } from '../adapters/install-adapter';
import { CommandAuditEntry } from '../adapters/toolchain-types';
import { readBooleanEnv, readEnv } from '../utils/env';
import { HelperService } from './helper-service';

const REAL_WORKER_ENV_KEYS = ['SIDELINK_ENABLE_REAL_WORKER', 'ALTSTORE_ENABLE_REAL_WORKER'];
const REAL_SIGNING_IDENTITY_ENV_KEYS = ['SIDELINK_REAL_SIGNING_IDENTITY', 'ALTSTORE_REAL_SIGNING_IDENTITY'];

const makeSteps = (): InstallJobStep[] => [
  { key: 'validate-inputs', label: 'Validate IPA + device', state: 'pending' },
  { key: 'ensure-helper-app', label: 'Ensure helper app on target device', state: 'pending' },
  { key: 'prepare-signing', label: 'Prepare signing context', state: 'pending' },
  { key: 'install-app', label: 'Install to device', state: 'pending' },
  { key: 'register-refresh', label: 'Register refresh lifecycle', state: 'pending' }
];

interface InstallJobRequest {
  ipaId: string;
  deviceId: string;
  mode: RuntimeMode;
  confirmRealExecution?: boolean;
}

interface RealExecutionGate {
  execute: boolean;
  reason: string;
  envEnabled: boolean;
  apiConfirmed: boolean;
}

interface PipelineAdapters {
  signingAdapter?: SigningAdapter;
  installAdapter?: InstallAdapter;
}

export class PipelineService {
  private readonly signingAdapter: SigningAdapter;
  private readonly installAdapter: InstallAdapter;
  private readonly deviceQueues = new Map<string, Promise<void>>();
  private readonly activeInstallKeys = new Map<string, string>();

  constructor(
    private readonly store: AppStore,
    private readonly ipaService: IpaService,
    private readonly devices: DeviceService,
    private readonly scheduler: SchedulerService,
    private readonly logs: LogService,
    private readonly helperService: HelperService,
    adapters: PipelineAdapters = {}
  ) {
    this.signingAdapter = adapters.signingAdapter ?? new RealSigningAdapter();
    this.installAdapter = adapters.installAdapter ?? new RealInstallAdapter();

    this.recoverInterruptedJobs();
    this.rebuildActiveInstallKeys();
  }

  public listJobs(): InstallJob[] {
    return Array.from(this.store.jobs.values()).sort(
      (a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime()
    );
  }

  public getJob(jobId: string): InstallJob | undefined {
    return this.store.jobs.get(jobId);
  }

  public listJobCommandRuns(jobId: string, limit = 200): ReturnType<AppStore['listJobCommandRuns']> {
    return this.store.listJobCommandRuns(jobId, limit);
  }

  public async enqueueInstall(params: InstallJobRequest): Promise<InstallJob> {
    const installKey = this.buildInstallKey(params);
    const activeJobId = this.activeInstallKeys.get(installKey);

    if (activeJobId) {
      const activeJob = this.store.jobs.get(activeJobId);
      if (activeJob && this.isInFlightStatus(activeJob.status)) {
        this.logDuplicateSuppressed(activeJob.id);
        return activeJob;
      }

      this.activeInstallKeys.delete(installKey);
    }

    const duplicate = this.findInFlightDuplicate(params);
    if (duplicate) {
      this.activeInstallKeys.set(installKey, duplicate.id);
      this.logDuplicateSuppressed(duplicate.id);
      return duplicate;
    }

    const job: InstallJob = {
      id: this.store.newId('job'),
      mode: params.mode,
      ipaId: params.ipaId,
      deviceId: params.deviceId,
      status: 'queued',
      queuedAt: new Date().toISOString(),
      steps: makeSteps(),
      commandPreview: [],
      realExecutionApproved: params.confirmRealExecution === true,
      helperEnsured: false
    };

    this.activeInstallKeys.set(installKey, job.id);

    this.ensureCommandPreview(job);
    this.store.saveJob(job);

    this.logs.push({
      level: 'info',
      code: 'INSTALL_JOB_QUEUED',
      message: `Queued install job ${job.id} (${job.mode}).`
    });

    this.scheduleRun(job);
    return job;
  }

  private findInFlightDuplicate(params: InstallJobRequest): InstallJob | undefined {
    return Array.from(this.store.jobs.values()).find(
      (existing) =>
        existing.mode === params.mode &&
        existing.ipaId === params.ipaId &&
        existing.deviceId === params.deviceId &&
        this.isInFlightStatus(existing.status)
    );
  }

  private logDuplicateSuppressed(jobId: string): void {
    this.logs.push({
      level: 'warn',
      code: 'INSTALL_JOB_DUPLICATE_SUPPRESSED',
      message: `Duplicate install request suppressed; reusing in-flight job ${jobId}.`,
      action: 'Wait for the existing job to finish or change IPA/device before queuing another install.'
    });
  }

  private isInFlightStatus(status: InstallJob['status']): boolean {
    return status === 'queued' || status === 'running';
  }

  private buildInstallKey(input: Pick<InstallJobRequest, 'mode' | 'deviceId' | 'ipaId'>): string {
    return `${input.mode}:${input.deviceId}:${input.ipaId}`;
  }

  private scheduleRun(job: InstallJob): void {
    const existing = this.deviceQueues.get(job.deviceId);
    if (existing) {
      this.logs.push({
        level: 'info',
        code: 'INSTALL_JOB_WAITING_DEVICE_LOCK',
        message: `Job ${job.id} is queued behind another active install on device ${job.deviceId}.`,
        action: 'Same-device installs are serialized to avoid signing/install collisions.'
      });
    }

    const runPromise = (existing ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await this.run(job.id);
      })
      .finally(() => {
        if (this.deviceQueues.get(job.deviceId) === runPromise) {
          this.deviceQueues.delete(job.deviceId);
        }
      });

    this.deviceQueues.set(job.deviceId, runPromise);
  }

  private async run(jobId: string): Promise<void> {
    const job = this.store.jobs.get(jobId);
    if (!job) {
      this.releaseActiveInstallKey(jobId);
      return;
    }

    let signedArtifact: SigningExecutionResult | undefined;

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    this.store.saveJob(job);

    try {
      const ipa = await this.runStep(job, 'validate-inputs', async () => {
        const ipaArtifact = this.ipaService.getById(job.ipaId);
        if (!ipaArtifact) {
          throw new AppError('IPA_NOT_FOUND', 'IPA not found for this job.', 404, 'Upload an IPA and retry install.');
        }

        const discovery = await this.devices.list(job.mode, true);
        const device = discovery.devices.find((entry) => entry.id === job.deviceId);
        if (!device) {
          throw new AppError(
            'DEVICE_NOT_FOUND',
            `Device ${job.deviceId} not found in ${job.mode.toUpperCase()} mode.`,
            400,
            'Refresh devices and pick a valid target.'
          );
        }

        if (job.mode === 'real' && (discovery.source !== 'real' || device.source !== 'real')) {
          throw new AppError(
            'REAL_DEVICE_SOURCE_REQUIRED',
            'Real mode requires a real connected iOS device; mock fallback sources are blocked.',
            400,
            'Install/repair libimobiledevice, reconnect + trust your iPhone, then rescan devices in real mode.'
          );
        }

        if (device.connection !== 'online') {
          throw new AppError(
            'DEVICE_UNAVAILABLE',
            `Device ${device.name} is ${device.connection}.`,
            400,
            'Unlock and trust device before installing.'
          );
        }

        return ipaArtifact;
      });

      const gate = this.evaluateRealExecutionGate(job);

      await this.runStep(job, 'ensure-helper-app', async () => {
        const helperStatus = await this.helperService.getArtifactStatus();
        const existingHelperInstall = this.findTrackedHelperInstall(job.deviceId, helperStatus.bundleId);

        if (existingHelperInstall) {
          const hoursRemaining = hoursBetween(this.scheduler.snapshot().simulatedNow, existingHelperInstall.expiresAt);

          if (hoursRemaining > 24) {
            job.helperEnsured = true;
            this.store.saveJob(job);

            this.logs.push({
              level: 'info',
              code: 'HELPER_ENSURE_ALREADY_HEALTHY',
              message: `Helper already tracked on device ${job.deviceId}; skipping reinstall for job ${job.id}.`,
              action: `Helper lifecycle has ${Math.floor(hoursRemaining)}h remaining before expiry.`
            });

            return `Helper already healthy on target device (${Math.floor(hoursRemaining)}h remaining); skipped reinstall.`;
          }
        }

        if (job.mode === 'demo') {
          await sleep(150);
          this.scheduler.registerInstall({
            jobId: job.id,
            ipaId: 'helper-managed',
            deviceId: job.deviceId,
            mode: job.mode,
            kind: 'helper',
            label: helperStatus.displayName,
            bundleId: helperStatus.bundleId,
            preferredTransport: 'wifi'
          });
          job.helperEnsured = true;
          this.store.saveJob(job);
          return 'Helper ensured in demo mode (simulated).';
        }

        if (!helperStatus.available) {
          this.logs.push({
            level: 'warn',
            code: 'HELPER_IPA_UNAVAILABLE',
            message: `Helper IPA not available for job ${job.id}; continuing without helper install.`,
            action: `${helperStatus.message} Run ${helperStatus.buildCommand} then ${helperStatus.exportCommand}.`
          });

          return `Helper IPA unavailable. ${helperStatus.message}`;
        }

        await this.installAdapter.ensureAvailable();

        if (!gate.execute) {
          await this.recordSkippedCommand(
            job.id,
            'ensure-helper-app',
            'ideviceinstaller',
            ['-u', job.deviceId, '-i', helperStatus.ipaPath],
            gate.reason
          );
          return `Helper preflight complete; install preview-only (${gate.reason}).`;
        }

        try {
          await this.installAdapter.preflightDevice(job.deviceId, (entry) => this.recordCommand(job.id, 'ensure-helper-app', entry));
          await this.installAdapter.install(
            {
              deviceId: job.deviceId,
              signedIpaPath: helperStatus.ipaPath
            },
            (entry) => this.recordCommand(job.id, 'ensure-helper-app', entry)
          );

          this.scheduler.registerInstall({
            jobId: job.id,
            ipaId: 'helper-managed',
            deviceId: job.deviceId,
            mode: job.mode,
            kind: 'helper',
            label: helperStatus.displayName,
            bundleId: helperStatus.bundleId,
            preferredTransport: 'wifi'
          });

          job.helperEnsured = true;
          this.store.saveJob(job);

          return 'Helper app installed/ensured before primary app install.';
        } catch (error) {
          const appError = error instanceof AppError
            ? error
            : new AppError('HELPER_ENSURE_FAILED', error instanceof Error ? error.message : String(error), 500);

          this.logs.push({
            level: 'warn',
            code: 'HELPER_ENSURE_SOFT_FAILED',
            message: `Helper ensure failed for job ${job.id}: ${appError.message}`,
            action: appError.action || 'Primary app install will continue; inspect helper command audit and rerun helper build/install as needed.'
          });

          return `Helper ensure failed but pipeline continued: ${appError.message}`;
        }
      });

      await this.runStep(job, 'prepare-signing', async () => {
        if (job.mode === 'demo') {
          await sleep(450);
          if (ipa.warnings.length) {
            this.logs.push({
              level: 'warn',
              code: 'SIGNING_WARNING',
              message: `IPA has ${ipa.warnings.length} signing warning(s).`,
              action: 'Warnings are tolerated in demo mode, but production signing should resolve them.'
            });
          }
          return 'Demo signing simulation complete.';
        }

        this.ensureCommandPreview(job);

        await this.signingAdapter.ensureAvailable();

        if (!gate.execute) {
          await this.recordSkippedCommand(job.id, 'prepare-signing', 'codesign', ['-f', '--deep', '-s', '<identity>', 'Payload/<App>.app'], gate.reason);
          this.logs.push({
            level: 'warn',
            code: 'REAL_EXECUTION_GATED',
            message: `Real signing stayed in preview mode for job ${job.id}.`,
            action: gate.reason
          });
          return `Real preflight passed; execution blocked by safety gate (${gate.reason}).`;
        }

        const signingIdentity = readEnv(...REAL_SIGNING_IDENTITY_ENV_KEYS);
        if (!signingIdentity) {
          throw new AppError(
            'REAL_SIGNING_IDENTITY_REQUIRED',
            'Set SIDELINK_REAL_SIGNING_IDENTITY to your Apple Development identity before guarded execution.',
            400,
            'Run `security find-identity -v -p codesigning`, copy an Apple Development identity, then retry.'
          );
        }

        signedArtifact = await this.signingAdapter.sign(
          {
            ipaPath: ipa.absolutePath,
            signingIdentity
          },
          (entry) => this.recordCommand(job.id, 'prepare-signing', entry)
        );

        if (signedArtifact.effectiveBundleId && signedArtifact.effectiveBundleId !== ipa.bundleId) {
          return `Real signing completed using ${signingIdentity}; bundle remapped to ${signedArtifact.effectiveBundleId}.`;
        }

        return `Real signing completed using ${signingIdentity}.`;
      });

      await this.runStep(job, 'install-app', async () => {
        if (job.mode === 'demo') {
          await sleep(650);
          return 'Demo install simulation complete.';
        }

        await this.installAdapter.ensureAvailable();

        if (!gate.execute) {
          await this.recordSkippedCommand(
            job.id,
            'install-app',
            'ideviceinstaller',
            ['-u', job.deviceId, '-i', '<signed.ipa>'],
            gate.reason
          );
          return `Real install stayed in preview mode (${gate.reason}).`;
        }

        if (!signedArtifact) {
          throw new AppError(
            'SIGNED_ARTIFACT_UNAVAILABLE',
            'Signing step did not produce a signed IPA.',
            500,
            'Re-run the job and inspect command logs for signing step failures.'
          );
        }

        await this.installAdapter.preflightDevice(job.deviceId, (entry) => this.recordCommand(job.id, 'install-app', entry));
        await this.installAdapter.install(
          {
            deviceId: job.deviceId,
            signedIpaPath: signedArtifact.signedIpaPath
          },
          (entry) => this.recordCommand(job.id, 'install-app', entry)
        );

        return 'Real install command executed successfully.';
      });

      await this.runStep(job, 'register-refresh', async () => {
        const installedBundleId = signedArtifact?.effectiveBundleId || ipa.bundleId;

        this.scheduler.registerInstall({
          jobId: job.id,
          ipaId: job.ipaId,
          deviceId: job.deviceId,
          mode: job.mode,
          kind: 'primary',
          label: ipa.displayName,
          bundleId: installedBundleId,
          preferredTransport: 'wifi'
        });

        if (installedBundleId !== ipa.bundleId) {
          return `Lifecycle registration complete (installed bundle: ${installedBundleId}).`;
        }

        return 'Lifecycle registration complete.';
      });

      job.status = 'success';
      job.endedAt = new Date().toISOString();
      this.store.saveJob(job);

      this.logs.push({
        level: 'info',
        code: 'INSTALL_JOB_SUCCESS',
        message: `Install job ${job.id} completed successfully (${job.mode}).`,
        action:
          job.mode === 'demo'
            ? 'Open lifecycle dashboard to observe auto-refresh planner behavior.'
            : gate.execute
              ? 'Inspect command audit logs for full signing/install trace.'
              : 'Open command audit to review preview path and enable guarded real execution when ready.'
      });
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError('INSTALL_JOB_FAILED', error instanceof Error ? error.message : String(error), 500);

      job.status = 'error';
      job.error = appError.message;
      job.action = appError.action;
      job.endedAt = new Date().toISOString();
      this.store.saveJob(job);

      this.logs.push({
        level: 'error',
        code: appError.code,
        message: `Install job ${job.id} failed: ${appError.message}`,
        action: appError.action
      });
    } finally {
      this.releaseActiveInstallKey(job.id);

      if (signedArtifact) {
        await signedArtifact.cleanup().catch(() => undefined);
      }
    }
  }

  private recoverInterruptedJobs(): void {
    const now = new Date().toISOString();
    const interrupted = Array.from(this.store.jobs.values()).filter((job) => this.isInFlightStatus(job.status));

    interrupted.forEach((job) => {
      let markedErrorStep = false;

      job.steps.forEach((step) => {
        if (step.state === 'running') {
          step.state = 'error';
          step.endedAt = now;
          step.detail = 'Job interrupted by service restart before completion.';
          step.action = 'Re-run this install to resume pipeline execution.';
          markedErrorStep = true;
        }
      });

      if (!markedErrorStep) {
        const firstPending = job.steps.find((step) => step.state === 'pending');
        if (firstPending) {
          firstPending.state = 'error';
          firstPending.startedAt = firstPending.startedAt ?? now;
          firstPending.endedAt = now;
          firstPending.detail = 'Job interrupted before execution started.';
          firstPending.action = 'Re-run this install to start the pipeline.';
          markedErrorStep = true;
        }
      }

      job.steps
        .filter((step) => step.state === 'pending')
        .forEach((step) => {
          step.state = 'skipped';
          step.detail = 'Skipped because the previous run was interrupted before this step.';
        });

      job.status = 'error';
      job.error = 'Install job was interrupted by service restart before completion.';
      job.action = 'Re-run this install to continue.';
      job.endedAt = now;

      this.store.saveJob(job);

      this.logs.push({
        level: 'warn',
        code: 'INSTALL_JOB_INTERRUPTED_RECOVERED',
        message: `Recovered interrupted install job ${job.id} from previous session.`,
        action: 'Re-run the install pipeline for this IPA/device pair to continue.'
      });
    });
  }

  private rebuildActiveInstallKeys(): void {
    this.activeInstallKeys.clear();

    Array.from(this.store.jobs.values())
      .filter((job) => this.isInFlightStatus(job.status))
      .forEach((job) => {
        this.activeInstallKeys.set(this.buildInstallKey(job), job.id);
      });
  }

  private releaseActiveInstallKey(jobId: string): void {
    for (const [key, trackedJobId] of this.activeInstallKeys.entries()) {
      if (trackedJobId === jobId) {
        this.activeInstallKeys.delete(key);
      }
    }
  }

  private async runStep<T>(job: InstallJob, key: string, fn: () => Promise<T>): Promise<T> {
    const step = job.steps.find((item) => item.key === key);
    if (!step) {
      throw new AppError('PIPELINE_STEP_MISSING', `Step ${key} not found on job.`);
    }

    step.state = 'running';
    step.startedAt = new Date().toISOString();
    this.store.saveJob(job);

    try {
      const result = await fn();
      step.state = 'success';
      step.endedAt = new Date().toISOString();
      if (typeof result === 'string') {
        step.detail = result;
      }
      this.store.saveJob(job);
      return result;
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError('PIPELINE_STEP_FAILED', error instanceof Error ? error.message : String(error), 500);

      step.state = 'error';
      step.endedAt = new Date().toISOString();
      step.detail = appError.message;
      step.action = appError.action;

      job.steps
        .filter((pending) => pending.state === 'pending')
        .forEach((pending) => {
          pending.state = 'skipped';
        });

      this.store.saveJob(job);
      throw appError;
    }
  }

  private evaluateRealExecutionGate(job: InstallJob): RealExecutionGate {
    if (job.mode !== 'real') {
      return {
        execute: false,
        reason: 'Real execution gate only applies in real mode.',
        envEnabled: false,
        apiConfirmed: false
      };
    }

    const envEnabled = readBooleanEnv(REAL_WORKER_ENV_KEYS, false);
    const apiConfirmed = job.realExecutionApproved === true;

    if (envEnabled && apiConfirmed) {
      return {
        execute: true,
        reason: 'Safety gate passed.',
        envEnabled,
        apiConfirmed
      };
    }

    const missing: string[] = [];
    if (!envEnabled) {
      missing.push('SIDELINK_ENABLE_REAL_WORKER=1');
    }
    if (!apiConfirmed) {
      missing.push('API body `confirmRealExecution: true`');
    }

    return {
      execute: false,
      reason: `Missing: ${missing.join(' + ')}`,
      envEnabled,
      apiConfirmed
    };
  }

  private findTrackedHelperInstall(deviceId: string, helperBundleId: string): ReturnType<SchedulerService['listInstalled']>[number] | undefined {
    return this.scheduler
      .listInstalled()
      .find((install) => install.kind === 'helper' && install.deviceId === deviceId && install.bundleId === helperBundleId);
  }

  private ensureCommandPreview(job: InstallJob): void {
    if (!job.commandPreview) {
      job.commandPreview = [];
    }

    const signingIdentity = readEnv(...REAL_SIGNING_IDENTITY_ENV_KEYS) || '<set SIDELINK_REAL_SIGNING_IDENTITY>';
    const helperIpa = readEnv('SIDELINK_HELPER_IPA_PATH', 'ALTSTORE_HELPER_IPA_PATH') || 'tmp/helper/SidelinkHelper.ipa';
    const previews = [
      `ideviceinstaller -u ${job.deviceId} install ${helperIpa}`,
      'security find-identity -v -p codesigning',
      `codesign -f --deep --generate-entitlement-der -s "${signingIdentity}" --entitlements <generated.plist> Payload/<App>.app`,
      `ideviceinstaller -u ${job.deviceId} install <signed.ipa>`
    ];

    previews.forEach((preview) => {
      if (!job.commandPreview?.includes(preview)) {
        job.commandPreview?.push(preview);
      }
    });

    this.store.saveJob(job);
  }

  private async recordCommand(jobId: string, stepKey: string, entry: CommandAuditEntry): Promise<void> {
    this.store.saveJobCommandRun({
      id: this.store.newId('cmd'),
      jobId,
      stepKey,
      command: entry.command,
      args: entry.args,
      cwd: entry.cwd,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      exitCode: entry.exitCode,
      status: entry.status,
      stdout: entry.stdout,
      stderr: entry.stderr,
      note: entry.note
    });
  }

  private async recordSkippedCommand(
    jobId: string,
    stepKey: string,
    command: string,
    args: string[],
    reason: string
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.recordCommand(jobId, stepKey, {
      command,
      args,
      startedAt: now,
      endedAt: now,
      status: 'skipped',
      note: reason
    });
  }
}
