import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Apple2FARequiredError, ProvisioningError, WeeklyAppIdLimitError } from '../src/server/utils/errors';
import {
  isJobWaitingFor2FA,
  onPipelineUpdate,
  startInstallPipeline,
  submitJobTwoFA,
} from '../src/server/pipeline/pipeline';

vi.mock('../src/server/signing', () => ({
  signIpa: vi.fn(async () => ({
    signedIpaPath: '/tmp/signed.ipa',
    cleanup: async () => {},
  })),
}));

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createDb() {
  const jobs = new Map<string, any>();

  return {
    createJob: vi.fn((job: any) => {
      jobs.set(job.id, clone(job));
    }),
    updateJob: vi.fn((job: any) => {
      jobs.set(job.id, clone(job));
    }),
    getJob: vi.fn((id: string) => {
      const job = jobs.get(id);
      return job ? clone(job) : null;
    }),
    listJobs: vi.fn((filters?: { status?: string; accountId?: string; deviceUdid?: string }) => {
      return [...jobs.values()]
        .filter(job => {
          if (filters?.status && job.status !== filters.status) return false;
          if (filters?.accountId && job.accountId !== filters.accountId) return false;
          if (filters?.deviceUdid && job.deviceUdid !== filters.deviceUdid) return false;
          return true;
        })
        .map(clone);
    }),
    upsertInstalledApp: vi.fn(),
  };
}

function createDeps(options?: {
  installApp?: (udid: string, ipaPath: string) => Promise<void>;
  provisionError?: Error;
  getDevClient?: () => Promise<unknown>;
}) {
  const db = createDb();
  const logs = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const account = { id: 'acc-1', teamId: 'TEAM123', accountType: 'free' };
  const ipa = {
    id: 'ipa-1',
    bundleId: 'com.example.demo',
    bundleName: 'Demo',
    bundleVersion: '1.0.0',
    filePath: '/tmp/demo.ipa',
    extensions: [],
  };

  const deps = {
    db,
    logs,
    accounts: {
      get: vi.fn(() => account),
      refreshAuth: vi.fn(async () => {}),
      getDevClient: vi.fn(options?.getDevClient ?? (async () => ({}))),
      complete2FAForAccount: vi.fn(async () => {}),
    },
    provisioning: {
      provision: vi.fn(async () => {
        if (options?.provisionError) throw options.provisionError;
        return {
          certificate: {
            id: 'cert-1',
            certificatePem: 'cert-pem',
            privateKeyPem: 'key-pem',
          },
          profile: {
            id: 'profile-1',
            profileData: Buffer.from('profile').toString('base64'),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          },
          effectiveBundleId: 'com.sidelink.demo',
          extensionProfiles: [],
        };
      }),
    },
    devices: {
      get: vi.fn(() => ({ udid: 'device-1', name: 'iPhone' })),
      installApp: vi.fn(options?.installApp ?? (async () => {})),
    },
    ipas: {
      get: vi.fn(() => ipa),
    },
    encryption: {} as any,
  };

  return { deps, db };
}

async function waitForTerminalJob(db: ReturnType<typeof createDb>, jobId: string) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const job = db.getJob(jobId);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    await sleep(15);
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

describe('pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an unsubscribe function for listeners', () => {
    const unsub = onPipelineUpdate(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('returns false for unknown 2FA job id', () => {
    expect(submitJobTwoFA('non-existent-job', '123456')).toBe(false);
    expect(isJobWaitingFor2FA('non-existent-job')).toBe(false);
  });

  it('serializes concurrent installs on the same device with a per-device mutex', async () => {
    let activeInstalls = 0;
    let maxConcurrentInstalls = 0;

    const { deps, db } = createDeps({
      installApp: async () => {
        activeInstalls += 1;
        maxConcurrentInstalls = Math.max(maxConcurrentInstalls, activeInstalls);
        await sleep(40);
        activeInstalls -= 1;
      },
    });

    const [jobA, jobB] = await Promise.all([
      startInstallPipeline(deps as any, {
        accountId: 'acc-1',
        ipaId: 'ipa-1',
        deviceUdid: 'device-1',
      }),
      startInstallPipeline(deps as any, {
        accountId: 'acc-1',
        ipaId: 'ipa-1',
        deviceUdid: 'device-1',
      }),
    ]);

    const [resultA, resultB] = await Promise.all([
      waitForTerminalJob(db, jobA.id),
      waitForTerminalJob(db, jobB.id),
    ]);

    expect(resultA.status).toBe('completed');
    expect(resultB.status).toBe('completed');
    expect(deps.devices.installApp).toHaveBeenCalledTimes(2);
    expect(maxConcurrentInstalls).toBe(1);
  });

  it('fails the pipeline when weekly app-id creation limit is reached', async () => {
    const { deps, db } = createDeps({
      provisionError: new WeeklyAppIdLimitError(10),
    });

    const job = await startInstallPipeline(deps as any, {
      accountId: 'acc-1',
      ipaId: 'ipa-1',
      deviceUdid: 'device-1',
    });
    const terminal = await waitForTerminalJob(db, job.id);

    expect(terminal.status).toBe('failed');
    expect(terminal.error).toContain('weekly App ID creation limit reached');
  });

  it('waits for 2FA when forced re-auth is required during provisioning retry', async () => {
    let devClientCalls = 0;
    const { deps, db } = createDeps({
      getDevClient: async (_accountId?: string, options?: { forceRefresh?: boolean }) => {
        devClientCalls += 1;
        if (options?.forceRefresh) {
          throw new Apple2FARequiredError({
            scnt: 'scnt',
            xAppleIdSessionId: 'session-id',
            authType: 'trustedDeviceSecondaryAuth',
          });
        }
        return {};
      },
    });

    const provisionSpy = deps.provisioning.provision as ReturnType<typeof vi.fn>;
    provisionSpy
      .mockRejectedValueOnce(new ProvisioningError('APPLE_DEVELOPER_API_ERROR', 'Apple Developer Services: Your session has expired. Please log in. (code: 1100)'))
      .mockResolvedValue({
        certificate: {
          id: 'cert-1',
          certificatePem: 'cert-pem',
          privateKeyPem: 'key-pem',
        },
        profile: {
          id: 'profile-1',
          profileData: Buffer.from('profile').toString('base64'),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        effectiveBundleId: 'com.sidelink.demo',
        extensionProfiles: [],
      });

    const job = await startInstallPipeline(deps as any, {
      accountId: 'acc-1',
      ipaId: 'ipa-1',
      deviceUdid: 'device-1',
    });

    const waitingDeadline = Date.now() + 2000;
    let waitingJob: any = null;
    while (Date.now() < waitingDeadline) {
      waitingJob = db.getJob(job.id);
      if (waitingJob?.status === 'waiting_2fa') break;
      await sleep(15);
    }

    expect(waitingJob?.status).toBe('waiting_2fa');
    expect(waitingJob?.currentStep).toBe('provision');
    expect(isJobWaitingFor2FA(job.id)).toBe(true);

    expect(submitJobTwoFA(job.id, '123456')).toBe(true);

    const terminal = await waitForTerminalJob(db, job.id);
    expect(terminal.status).toBe('completed');
    expect(deps.accounts.complete2FAForAccount).toHaveBeenCalledWith('acc-1', '123456');
    expect(devClientCalls).toBeGreaterThanOrEqual(2);
  });
});
