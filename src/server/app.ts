import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { createAppContext, AppContext } from './context';
import { AppConfig, InstallJob, JobCommandRun, LogEntry, LogLevel, RuntimeMode } from './types';
import { LogQueryInput } from './services/log-service';
import { AppError, toAppError } from './utils/errors';
import { hoursBetween } from './utils/time';
import { parseCookies } from './utils/cookie';
import { readBooleanEnv, readEnv } from './utils/env';
import { redactSensitiveText, redactUnknown } from './utils/redaction';

export interface BuiltApp {
  app: express.Express;
  context: AppContext;
}

interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
}

const readPackageMetadata = (): PackageMetadata => {
  const packagePath = path.resolve(process.cwd(), 'package.json');

  try {
    const raw = readFileSync(packagePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PackageMetadata>;

    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'sidelink',
      version: typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : '0.0.0',
      description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : undefined
    };
  } catch {
    return {
      name: 'sidelink',
      version: '0.0.0'
    };
  }
};

const PACKAGE_METADATA = readPackageMetadata();

const parseMode = (mode: unknown, fallback: RuntimeMode = 'demo'): RuntimeMode => {
  if (mode === undefined || mode === null) {
    return fallback;
  }

  if (typeof mode === 'string') {
    const normalized = mode.trim().toLowerCase();

    if (!normalized) {
      return fallback;
    }

    if (normalized === 'real' || normalized === 'demo') {
      return normalized;
    }
  }

  throw new AppError('MODE_INVALID', 'Mode must be `demo` or `real`.', 400, 'Set mode to `demo` or `real` and retry.');
};

const toBoolean = (value: unknown): boolean => value === true || value === 'true' || value === 1 || value === '1';

const parseBoundedInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const readQueryString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        return item.trim();
      }
    }
  }

  return undefined;
};

const LOG_LEVELS: LogLevel[] = ['info', 'warn', 'error', 'debug'];
const LOG_LEVEL_SET = new Set<LogLevel>(LOG_LEVELS);

const JOB_STATUSES: InstallJob['status'][] = ['queued', 'running', 'success', 'error'];
const JOB_STATUS_SET = new Set<InstallJob['status']>(JOB_STATUSES);

const COMMAND_RUN_STATUSES: JobCommandRun['status'][] = ['success', 'error', 'skipped'];
const COMMAND_RUN_STATUS_SET = new Set<JobCommandRun['status']>(COMMAND_RUN_STATUSES);

const parseTimestampFilter = (value: unknown, keyName: string, errorCode: string): string | undefined => {
  const raw = readQueryString(value);
  if (!raw) {
    return undefined;
  }

  const parsed = new Date(raw).getTime();
  if (!Number.isFinite(parsed)) {
    throw new AppError(
      errorCode,
      `Invalid \`${keyName}\` timestamp value.`,
      400,
      `Use a valid ISO timestamp for \`${keyName}\` (example: ${new Date().toISOString()}).`
    );
  }

  return new Date(parsed).toISOString();
};

const assertTimestampRange = (
  before: string | undefined,
  after: string | undefined,
  options: {
    errorCode: string;
    beforeKey: string;
    afterKey: string;
  }
): void => {
  if (before && after && new Date(after).getTime() > new Date(before).getTime()) {
    throw new AppError(
      options.errorCode,
      `Invalid time range: \`${options.afterKey}\` must be <= \`${options.beforeKey}\`.`,
      400,
      `Provide a time window where \`${options.afterKey}\` is earlier than or equal to \`${options.beforeKey}\`.`
    );
  }
};

const toEpochMs = (iso: string | undefined): number | undefined => {
  if (!iso) {
    return undefined;
  }

  const parsed = new Date(iso).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseOptionalModeFilter = (value: unknown, keyName: string, errorCode: string): RuntimeMode | undefined => {
  const raw = readQueryString(value);
  if (!raw) {
    return undefined;
  }

  const normalized = raw.toLowerCase();
  if (normalized === 'demo' || normalized === 'real') {
    return normalized;
  }

  throw new AppError(errorCode, `Invalid \`${keyName}\` filter value: ${raw}.`, 400, 'Use `demo` or `real`.');
};

const parseLogLevels = (value: unknown, keyName: string): LogLevel[] | undefined => {
  const raw = readQueryString(value);
  if (!raw) {
    return undefined;
  }

  const entries = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!entries.length) {
    return undefined;
  }

  const invalid = entries.filter((entry): entry is string => !LOG_LEVEL_SET.has(entry as LogLevel));
  if (invalid.length) {
    throw new AppError(
      'LOG_FILTER_LEVEL_INVALID',
      `Invalid \`${keyName}\` filter value: ${invalid.join(', ')}.`,
      400,
      `Use comma-separated levels from: ${LOG_LEVELS.join(', ')}.`
    );
  }

  return Array.from(new Set(entries as LogLevel[]));
};

const parseJobStatuses = (value: unknown, keyName: string): InstallJob['status'][] | undefined => {
  const raw = readQueryString(value);
  if (!raw) {
    return undefined;
  }

  const entries = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!entries.length) {
    return undefined;
  }

  const invalid = entries.filter((entry): entry is string => !JOB_STATUS_SET.has(entry as InstallJob['status']));
  if (invalid.length) {
    throw new AppError(
      'JOB_FILTER_STATUS_INVALID',
      `Invalid \`${keyName}\` filter value: ${invalid.join(', ')}.`,
      400,
      `Use comma-separated statuses from: ${JOB_STATUSES.join(', ')}.`
    );
  }

  return Array.from(new Set(entries as InstallJob['status'][]));
};

const parseCommandRunStatuses = (value: unknown, keyName: string): JobCommandRun['status'][] | undefined => {
  const raw = readQueryString(value);
  if (!raw) {
    return undefined;
  }

  const entries = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!entries.length) {
    return undefined;
  }

  const invalid = entries.filter((entry): entry is string => !COMMAND_RUN_STATUS_SET.has(entry as JobCommandRun['status']));
  if (invalid.length) {
    throw new AppError(
      'COMMAND_FILTER_STATUS_INVALID',
      `Invalid \`${keyName}\` filter value: ${invalid.join(', ')}.`,
      400,
      `Use comma-separated statuses from: ${COMMAND_RUN_STATUSES.join(', ')}.`
    );
  }

  return Array.from(new Set(entries as JobCommandRun['status'][]));
};

interface ParsedLogFilters {
  levels?: LogLevel[];
  code?: string;
  search?: string;
  before?: string;
  after?: string;
}

interface ParsedJobFilters {
  statuses?: InstallJob['status'][];
  mode?: RuntimeMode;
  deviceId?: string;
  ipaId?: string;
  before?: string;
  after?: string;
}

interface ParsedCommandRunFilters {
  statuses?: JobCommandRun['status'][];
  stepKey?: string;
  search?: string;
  before?: string;
  after?: string;
}

interface ParseLogFilterOptions {
  levelKey?: string;
  codeKey?: string;
  searchKey?: string;
  beforeKey?: string;
  afterKey?: string;
}

interface ParseJobFilterOptions {
  statusKey?: string;
  modeKey?: string;
  deviceIdKey?: string;
  ipaIdKey?: string;
  beforeKey?: string;
  afterKey?: string;
}

interface ParseCommandRunFilterOptions {
  statusKey?: string;
  stepKeyKey?: string;
  searchKey?: string;
  beforeKey?: string;
  afterKey?: string;
}

const parseLogFilters = (query: Record<string, unknown>, options: ParseLogFilterOptions = {}): ParsedLogFilters => {
  const levelKey = options.levelKey ?? 'level';
  const codeKey = options.codeKey ?? 'code';
  const searchKey = options.searchKey ?? 'search';
  const beforeKey = options.beforeKey ?? 'before';
  const afterKey = options.afterKey ?? 'after';

  const levels = parseLogLevels(query[levelKey], levelKey);
  const code = readQueryString(query[codeKey]);
  const search = readQueryString(query[searchKey]);
  const before = parseTimestampFilter(query[beforeKey], beforeKey, 'LOG_FILTER_TIME_INVALID');
  const after = parseTimestampFilter(query[afterKey], afterKey, 'LOG_FILTER_TIME_INVALID');

  assertTimestampRange(before, after, {
    errorCode: 'LOG_FILTER_RANGE_INVALID',
    beforeKey,
    afterKey
  });

  return {
    levels,
    code,
    search,
    before,
    after
  };
};

const parseJobFilters = (query: Record<string, unknown>, options: ParseJobFilterOptions = {}): ParsedJobFilters => {
  const statusKey = options.statusKey ?? 'status';
  const modeKey = options.modeKey ?? 'mode';
  const deviceIdKey = options.deviceIdKey ?? 'deviceId';
  const ipaIdKey = options.ipaIdKey ?? 'ipaId';
  const beforeKey = options.beforeKey ?? 'before';
  const afterKey = options.afterKey ?? 'after';

  const statuses = parseJobStatuses(query[statusKey], statusKey);
  const mode = parseOptionalModeFilter(query[modeKey], modeKey, 'JOB_FILTER_MODE_INVALID');
  const deviceId = readQueryString(query[deviceIdKey]);
  const ipaId = readQueryString(query[ipaIdKey]);
  const before = parseTimestampFilter(query[beforeKey], beforeKey, 'JOB_FILTER_TIME_INVALID');
  const after = parseTimestampFilter(query[afterKey], afterKey, 'JOB_FILTER_TIME_INVALID');

  assertTimestampRange(before, after, {
    errorCode: 'JOB_FILTER_RANGE_INVALID',
    beforeKey,
    afterKey
  });

  return {
    statuses,
    mode,
    deviceId,
    ipaId,
    before,
    after
  };
};

const parseCommandRunFilters = (
  query: Record<string, unknown>,
  options: ParseCommandRunFilterOptions = {}
): ParsedCommandRunFilters => {
  const statusKey = options.statusKey ?? 'status';
  const stepKeyKey = options.stepKeyKey ?? 'stepKey';
  const searchKey = options.searchKey ?? 'search';
  const beforeKey = options.beforeKey ?? 'before';
  const afterKey = options.afterKey ?? 'after';

  const statuses = parseCommandRunStatuses(query[statusKey], statusKey);
  const stepKey = readQueryString(query[stepKeyKey]);
  const search = readQueryString(query[searchKey]);
  const before = parseTimestampFilter(query[beforeKey], beforeKey, 'COMMAND_FILTER_TIME_INVALID');
  const after = parseTimestampFilter(query[afterKey], afterKey, 'COMMAND_FILTER_TIME_INVALID');

  assertTimestampRange(before, after, {
    errorCode: 'COMMAND_FILTER_RANGE_INVALID',
    beforeKey,
    afterKey
  });

  return {
    statuses,
    stepKey,
    search,
    before,
    after
  };
};

const buildLogFiltersMeta = (filters: ParsedLogFilters): Record<string, unknown> => {
  const meta: Record<string, unknown> = {};

  if (filters.levels?.length) {
    meta.level = filters.levels.join(',');
  }

  if (filters.code) {
    meta.code = filters.code;
  }

  if (filters.search) {
    meta.search = filters.search;
  }

  if (filters.before) {
    meta.before = filters.before;
  }

  if (filters.after) {
    meta.after = filters.after;
  }

  return meta;
};

const buildJobFiltersMeta = (filters: ParsedJobFilters): Record<string, unknown> => {
  const meta: Record<string, unknown> = {};

  if (filters.statuses?.length) {
    meta.status = filters.statuses.join(',');
  }

  if (filters.mode) {
    meta.mode = filters.mode;
  }

  if (filters.deviceId) {
    meta.deviceId = filters.deviceId;
  }

  if (filters.ipaId) {
    meta.ipaId = filters.ipaId;
  }

  if (filters.before) {
    meta.before = filters.before;
  }

  if (filters.after) {
    meta.after = filters.after;
  }

  return meta;
};

const buildCommandRunFiltersMeta = (filters: ParsedCommandRunFilters): Record<string, unknown> => {
  const meta: Record<string, unknown> = {};

  if (filters.statuses?.length) {
    meta.status = filters.statuses.join(',');
  }

  if (filters.stepKey) {
    meta.stepKey = filters.stepKey;
  }

  if (filters.search) {
    meta.search = filters.search;
  }

  if (filters.before) {
    meta.before = filters.before;
  }

  if (filters.after) {
    meta.after = filters.after;
  }

  return meta;
};

const sanitizeLogEntry = (entry: LogEntry): LogEntry => ({
  ...entry,
  message: redactSensitiveText(entry.message),
  action: entry.action ? redactSensitiveText(entry.action) : undefined,
  context: entry.context ? (redactUnknown(entry.context) as Record<string, unknown>) : undefined
});

const sanitizeCommandRun = (run: JobCommandRun): JobCommandRun => ({
  ...run,
  command: redactSensitiveText(run.command),
  args: run.args.map((arg) => redactSensitiveText(arg)),
  cwd: run.cwd ? redactSensitiveText(run.cwd) : undefined,
  stdout: run.stdout ? redactSensitiveText(run.stdout) : undefined,
  stderr: run.stderr ? redactSensitiveText(run.stderr) : undefined,
  note: run.note ? redactSensitiveText(run.note) : undefined
});

const sanitizeInstallJob = (job: InstallJob): InstallJob => ({
  ...job,
  error: job.error ? redactSensitiveText(job.error) : undefined,
  action: job.action ? redactSensitiveText(job.action) : undefined,
  commandPreview: job.commandPreview?.map((preview) => redactSensitiveText(preview)),
  steps: job.steps.map((step) => ({
    ...step,
    detail: step.detail ? redactSensitiveText(step.detail) : undefined,
    action: step.action ? redactSensitiveText(step.action) : undefined
  }))
});

const filterJobs = (jobs: InstallJob[], filters: ParsedJobFilters): InstallJob[] => {
  const statusSet = filters.statuses?.length ? new Set(filters.statuses) : undefined;
  const beforeMs = toEpochMs(filters.before);
  const afterMs = toEpochMs(filters.after);

  return jobs.filter((job) => {
    if (statusSet && !statusSet.has(job.status)) {
      return false;
    }

    if (filters.mode && job.mode !== filters.mode) {
      return false;
    }

    if (filters.deviceId && job.deviceId !== filters.deviceId) {
      return false;
    }

    if (filters.ipaId && job.ipaId !== filters.ipaId) {
      return false;
    }

    const queuedAtMs = toEpochMs(job.queuedAt);

    if (beforeMs !== undefined && queuedAtMs !== undefined && queuedAtMs > beforeMs) {
      return false;
    }

    if (afterMs !== undefined && queuedAtMs !== undefined && queuedAtMs < afterMs) {
      return false;
    }

    return true;
  });
};

const filterCommandRuns = (runs: JobCommandRun[], filters: ParsedCommandRunFilters): JobCommandRun[] => {
  const statusSet = filters.statuses?.length ? new Set(filters.statuses) : undefined;
  const stepNeedle = filters.stepKey?.toLowerCase();
  const searchNeedle = filters.search?.toLowerCase();
  const beforeMs = toEpochMs(filters.before);
  const afterMs = toEpochMs(filters.after);

  return runs.filter((run) => {
    if (statusSet && !statusSet.has(run.status)) {
      return false;
    }

    if (stepNeedle && run.stepKey.toLowerCase() !== stepNeedle) {
      return false;
    }

    const startedAtMs = toEpochMs(run.startedAt);

    if (beforeMs !== undefined && startedAtMs !== undefined && startedAtMs > beforeMs) {
      return false;
    }

    if (afterMs !== undefined && startedAtMs !== undefined && startedAtMs < afterMs) {
      return false;
    }

    if (searchNeedle) {
      const haystack = [run.command, ...run.args, run.cwd ?? '', run.note ?? '', run.stdout ?? '', run.stderr ?? '']
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(searchNeedle)) {
        return false;
      }
    }

    return true;
  });
};

const resolveUptimeSeconds = (startedAt: string): number => {
  const startedAtMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return Math.max(0, Math.floor(process.uptime()));
  }

  const diffMs = Date.now() - startedAtMs;
  return Math.max(0, Math.floor(diffMs / 1000));
};

const ensureStaticDir = (): string => {
  const candidateFromEnv = readEnv('SIDELINK_CLIENT_DIR', 'ALTSTORE_CLIENT_DIR');

  const candidates = [
    candidateFromEnv,
    path.resolve(__dirname, '../client'),
    path.resolve(process.cwd(), 'src/client'),
    path.resolve(process.cwd(), 'dist/client')
  ].filter((candidate): candidate is string => Boolean(candidate));

  const match = candidates.find((candidate) => existsSync(path.join(candidate, 'index.html')));
  if (!match) {
    throw new Error(`Could not resolve client static directory. Checked: ${candidates.join(', ')}`);
  }

  return match;
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'"
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

export const buildApp = (configOverrides: Partial<AppConfig> = {}): BuiltApp => {
  const context = createAppContext(configOverrides);
  const app = express();
  const staticDir = ensureStaticDir();

  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(header, value);
    }
    next();
  });

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, context.config.uploadDir),
      filename: (_req, file, callback) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
        callback(null, `${Date.now()}-${safe}`);
      }
    }),
    limits: {
      fileSize: 1024 * 1024 * 600
    },
    fileFilter: (_req, file, callback) => {
      if (!file.originalname.toLowerCase().endsWith('.ipa')) {
        callback(new AppError('INVALID_FILE_TYPE', 'Only .ipa files are allowed.', 400, 'Rename/correct the file extension and retry.'));
        return;
      }
      callback(null, true);
    }
  });

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/assets', express.static(staticDir));

  const readSessionToken = (req: Request): string | undefined => {
    const cookies = parseCookies(req.headers.cookie);
    const raw = cookies[context.authService.cookieName];
    return raw?.trim() || undefined;
  };

  const readHeaderToken = (value: string | string[] | undefined): string | undefined => {
    if (Array.isArray(value)) {
      return readQueryString(value);
    }

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    return undefined;
  };

  const readHelperToken = (req: Request): string | undefined => {
    const primary = readHeaderToken(req.headers['x-sidelink-helper-token']);
    if (primary) {
      return primary;
    }

    const legacy = readHeaderToken(req.headers['x-altstore-helper-token']);
    if (legacy) {
      return legacy;
    }

    return readQueryString(req.query.token);
  };

  const getAuthenticatedUser = (req: Request) => context.authService.authenticate(readSessionToken(req));

  const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
    const user = getAuthenticatedUser(req);
    if (!user) {
      next(new AppError('AUTH_REQUIRED', 'Authentication required for this action.', 401, 'Log in via /api/auth/login first.'));
      return;
    }

    (req as Request & { authUser?: typeof user }).authUser = user;
    next();
  };

  const requireAuthOrHelperToken = (req: Request, _res: Response, next: NextFunction) => {
    const user = getAuthenticatedUser(req);
    if (user) {
      (req as Request & { authUser?: typeof user }).authUser = user;
      next();
      return;
    }

    const helperToken = readHelperToken(req);
    if (context.helperService.verifyToken(helperToken)) {
      next();
      return;
    }

    next(
      new AppError(
        'HELPER_AUTH_REQUIRED',
        'Helper token required. Provide x-sidelink-helper-token or authenticate in the web UI.',
        401,
        'Open Settings in web UI to copy/rotate helper token.'
      )
    );
  };

  const collectDashboardPayload = async () => {
    const scheduler = context.schedulerService.snapshot();
    const now = scheduler.simulatedNow;
    const installs = context.schedulerService.listInstalled();
    const ipas = context.ipaService.list();
    const ipaById = new Map(ipas.map((ipa) => [ipa.id, ipa]));

    const [demoDevices, realDevices] = await Promise.all([
      context.deviceService.list('demo'),
      context.deviceService.list('real')
    ]);

    const deviceById = new Map(
      [...demoDevices.devices, ...realDevices.devices].map((device) => [device.id, device])
    );

    const cards = installs.map((install) => {
      const ipa = ipaById.get(install.ipaId);
      const device = deviceById.get(install.deviceId);
      const hoursRemaining = hoursBetween(now, install.expiresAt);

      return {
        ...install,
        ipa: ipa
          ? {
              id: ipa.id,
              displayName: ipa.displayName,
              bundleId: ipa.bundleId,
              version: ipa.version
            }
          : undefined,
        device: device
          ? {
              id: device.id,
              name: device.name,
              connection: device.connection,
              source: device.source,
              transport: device.transport,
              networkName: device.networkName
            }
          : undefined,
        hoursRemaining: Math.round(hoursRemaining * 10) / 10,
        expired: hoursRemaining <= 0,
        refreshWindowOpen: hoursRemaining <= scheduler.autoRefreshThresholdHours
      };
    });

    return {
      now,
      scheduler,
      installs: cards,
      counts: {
        installs: cards.length,
        expiring: cards.filter((item) => item.health === 'expiring').length,
        expired: cards.filter((item) => item.health === 'expired').length,
        helperInstalls: cards.filter((item) => item.kind === 'helper').length
      }
    };
  };

  const selectHelperRefreshTarget = <T extends { id: string; kind: string; deviceId: string; expiresAt: string }>(
    installs: T[],
    options: { installId?: string; deviceId?: string } = {}
  ): T | undefined => {
    if (options.installId) {
      return installs.find((install) => install.id === options.installId);
    }

    const candidates = installs
      .filter((install) => (options.deviceId ? install.deviceId === options.deviceId : true))
      .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());

    return candidates.find((install) => install.kind === 'primary') ?? candidates[0];
  };

  app.get('/', (_req, res) => {
    res.sendFile(path.resolve(staticDir, 'index.html'));
  });

  app.get('/api/health', async (_req, res) => {
    const helperArtifact = await context.helperService.getArtifactStatus();

    res.json({
      ok: true,
      mode: context.store.mode,
      dbPath: context.store.getDatabasePath(),
      startedAt: context.startedAt,
      uptimeSeconds: resolveUptimeSeconds(context.startedAt),
      package: {
        name: PACKAGE_METADATA.name,
        version: PACKAGE_METADATA.version,
        description: PACKAGE_METADATA.description
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid
      },
      helper: {
        artifactAvailable: helperArtifact.available
      },
      counts: {
        ipas: context.store.ipas.size,
        jobs: context.store.jobs.size,
        installs: context.store.installedApps.size
      }
    });
  });

  app.get('/api/overview', requireAuth, async (_req, res, next) => {
    try {
      const dashboard = await collectDashboardPayload();
      const jobs = context.pipelineService.listJobs();
      const helperArtifact = await context.helperService.getArtifactStatus();

      res.json({
        ...dashboard,
        mode: context.store.mode,
        jobs: {
          queued: jobs.filter((job) => job.status === 'queued').length,
          running: jobs.filter((job) => job.status === 'running').length,
          failed: jobs.filter((job) => job.status === 'error').length,
          success: jobs.filter((job) => job.status === 'success').length
        },
        safety: {
          realWorkerEnvEnabled: readBooleanEnv(['SIDELINK_ENABLE_REAL_WORKER', 'ALTSTORE_ENABLE_REAL_WORKER'], false),
          helperArtifactAvailable: helperArtifact.available
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/support/snapshot', requireAuth, async (req, res, next) => {
    try {
      const includeLogs = !['0', 'false'].includes(String(req.query.includeLogs ?? '').toLowerCase());
      const logLimit = parseBoundedInt(req.query.logLimit, 250, 0, 1200);
      const includeCommandRuns = toBoolean(req.query.includeCommands);

      const logFilters = parseLogFilters(req.query as Record<string, unknown>, {
        levelKey: 'logLevel',
        codeKey: 'logCode',
        searchKey: 'logSearch',
        beforeKey: 'logBefore',
        afterKey: 'logAfter'
      });

      const jobFilters = parseJobFilters(req.query as Record<string, unknown>, {
        statusKey: 'jobStatus',
        modeKey: 'jobMode',
        deviceIdKey: 'jobDeviceId',
        ipaIdKey: 'jobIpaId',
        beforeKey: 'jobBefore',
        afterKey: 'jobAfter'
      });

      const jobLimitRequested = req.query.jobLimit !== undefined;
      const jobLimit = jobLimitRequested ? parseBoundedInt(req.query.jobLimit, 250, 1, 600) : undefined;

      const commandRunFilters: ParsedCommandRunFilters = includeCommandRuns
        ? parseCommandRunFilters(req.query as Record<string, unknown>, {
            statusKey: 'commandStatus',
            stepKeyKey: 'commandStepKey',
            searchKey: 'commandSearch',
            beforeKey: 'commandBefore',
            afterKey: 'commandAfter'
          })
        : {};

      const commandLimit = includeCommandRuns ? parseBoundedInt(req.query.commandLimit, 200, 1, 600) : 0;

      const [dashboard, helperArtifact] = await Promise.all([collectDashboardPayload(), context.helperService.getArtifactStatus()]);
      const rawJobs = context.pipelineService.listJobs();
      const matchedJobs = filterJobs(rawJobs, jobFilters);
      const selectedJobs = jobLimit === undefined ? matchedJobs : matchedJobs.slice(0, jobLimit);
      const jobs = selectedJobs.map((job) => sanitizeInstallJob(job));

      const jobsMeta = {
        requestedLimit: jobLimitRequested ? (jobLimit ?? null) : null,
        returned: jobs.length,
        matched: matchedJobs.length,
        totalStored: rawJobs.length,
        hasMore: matchedJobs.length > jobs.length,
        filters: buildJobFiltersMeta(jobFilters)
      };

      const commandRunsMetaByJob: Record<
        string,
        {
          returned: number;
          matched: number;
          totalStored: number;
          hasMore: boolean;
        }
      > = {};

      const commandRunsByJob = includeCommandRuns
        ? Object.fromEntries(
            selectedJobs.map((job) => {
              const allRuns = context.pipelineService.listJobCommandRuns(job.id, 1200);
              const matchedRuns = filterCommandRuns(allRuns, commandRunFilters);
              const selectedRuns = matchedRuns.slice(0, commandLimit).map((run) => {
                const sanitizedRun = sanitizeCommandRun(run);

                return {
                  id: sanitizedRun.id,
                  stepKey: sanitizedRun.stepKey,
                  command: sanitizedRun.command,
                  args: sanitizedRun.args,
                  cwd: sanitizedRun.cwd,
                  startedAt: sanitizedRun.startedAt,
                  endedAt: sanitizedRun.endedAt,
                  exitCode: sanitizedRun.exitCode,
                  status: sanitizedRun.status,
                  note: sanitizedRun.note,
                  stdoutLength: sanitizedRun.stdout?.length ?? 0,
                  stderrLength: sanitizedRun.stderr?.length ?? 0
                };
              });

              commandRunsMetaByJob[job.id] = {
                returned: selectedRuns.length,
                matched: matchedRuns.length,
                totalStored: allRuns.length,
                hasMore: matchedRuns.length > selectedRuns.length
              };

              return [job.id, selectedRuns];
            })
          )
        : undefined;

      const commandRunsMeta = {
        includeCommandRuns,
        requestedLimit: includeCommandRuns ? commandLimit : null,
        filters: includeCommandRuns ? buildCommandRunFiltersMeta(commandRunFilters) : {},
        jobs: includeCommandRuns ? commandRunsMetaByJob : undefined
      };

      const logQueryInput: LogQueryInput = {
        limit: includeLogs ? logLimit : 0,
        ...logFilters
      };
      const logsResult = context.logs.query(logQueryInput);
      const logs = includeLogs ? logsResult.items.map((entry) => sanitizeLogEntry(entry)) : [];
      const logsMeta = {
        includeLogs,
        requestedLimit: logLimit,
        returned: logs.length,
        matched: logsResult.matched,
        totalStored: logsResult.totalStored,
        hasMore: logsResult.hasMore,
        filters: buildLogFiltersMeta(logFilters)
      };

      const generatedAt = new Date().toISOString();
      const payload = {
        generatedAt,
        package: {
          name: PACKAGE_METADATA.name,
          version: PACKAGE_METADATA.version,
          description: PACKAGE_METADATA.description
        },
        runtime: {
          startedAt: context.startedAt,
          uptimeSeconds: resolveUptimeSeconds(context.startedAt),
          mode: context.store.mode,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid
        },
        counts: {
          ipas: context.store.ipas.size,
          jobs: jobs.length,
          installs: dashboard.installs.length,
          logs: logs.length
        },
        scheduler: dashboard.scheduler,
        overview: {
          counts: dashboard.counts,
          installs: dashboard.installs,
          jobs: {
            queued: jobs.filter((job) => job.status === 'queued').length,
            running: jobs.filter((job) => job.status === 'running').length,
            failed: jobs.filter((job) => job.status === 'error').length,
            success: jobs.filter((job) => job.status === 'success').length
          }
        },
        safety: {
          realWorkerEnvEnabled: readBooleanEnv(['SIDELINK_ENABLE_REAL_WORKER', 'ALTSTORE_ENABLE_REAL_WORKER'], false),
          helperArtifactAvailable: helperArtifact.available
        },
        helper: {
          artifactAvailable: helperArtifact.available,
          xcodebuildAvailable: helperArtifact.xcodebuildAvailable,
          xcodegenAvailable: helperArtifact.xcodegenAvailable,
          ipaPath: helperArtifact.ipaPath,
          projectPath: helperArtifact.projectPath,
          checkedAt: helperArtifact.checkedAt,
          message: helperArtifact.message
        },
        jobsMeta,
        jobs,
        commandRunsMeta,
        commandRunsByJob,
        logsMeta,
        logs
      };

      if (toBoolean(req.query.download)) {
        const stamp = generatedAt.replace(/[:.]/g, '-');
        res.setHeader('Content-Disposition', `attachment; filename="sidelink-support-${stamp}.json"`);
      }

      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/auth/session', (req, res) => {
    const user = getAuthenticatedUser(req);
    res.json({
      authenticated: Boolean(user),
      user,
      cookieName: context.authService.cookieName
    });
  });

  app.post('/api/auth/login', (req, res, next) => {
    try {
      const username = String(req.body.username ?? '').trim();
      const password = String(req.body.password ?? '');

      const session = context.authService.login({
        username,
        password,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });

      res.cookie(context.authService.cookieName, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        expires: new Date(session.expiresAt)
      });

      res.json({
        authenticated: true,
        user: session.user,
        expiresAt: session.expiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    context.authService.logout(readSessionToken(req));

    res.clearCookie(context.authService.cookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    res.json({ ok: true });
  });

  app.get('/api/settings', requireAuth, async (_req, res) => {
    const helperArtifact = await context.helperService.getArtifactStatus();

    res.json({
      mode: context.store.mode,
      scheduler: context.schedulerService.snapshot(),
      safety: {
        realWorkerEnvEnabled: readBooleanEnv(['SIDELINK_ENABLE_REAL_WORKER', 'ALTSTORE_ENABLE_REAL_WORKER'], false),
        helperTokenConfigured: Boolean(context.helperService.getToken()),
        helperTokenPreview: `${context.helperService.getToken().slice(0, 4)}••••${context.helperService.getToken().slice(-4)}`
      },
      helper: helperArtifact
    });
  });

  app.post('/api/settings/helper-token/rotate', requireAuth, (req, res) => {
    const token = context.helperService.rotateToken();
    res.json({
      token,
      preview: `${token.slice(0, 4)}••••${token.slice(-4)}`
    });
  });

  app.get('/api/mode', (_req, res) => {
    res.json({ mode: context.store.mode });
  });

  app.post('/api/mode', requireAuth, (req, res) => {
    const mode = parseMode(req.body.mode, context.store.mode);
    context.store.setMode(mode);
    context.logs.push({
      level: 'info',
      code: 'MODE_CHANGED',
      message: `Runtime mode switched to ${mode.toUpperCase()}.`,
      action:
        mode === 'real'
          ? 'Real mode runs guarded command execution only when env + API safety gates are enabled.'
          : 'Demo mode uses deterministic simulation for reliable testing.'
    });
    res.json({ mode });
  });

  app.get('/api/ipa', requireAuth, (_req, res) => {
    res.json({ items: context.ipaService.list() });
  });

  app.get('/api/ipa/:id', requireAuth, (req, res, next) => {
    const item = context.ipaService.getById(req.params.id);
    if (!item) {
      next(new AppError('IPA_NOT_FOUND', 'IPA not found.', 404));
      return;
    }
    res.json({ item });
  });

  app.post('/api/ipa/upload', requireAuth, upload.single('ipa'), async (req, res, next) => {
    try {
      if (!req.file) {
        throw new AppError('IPA_FILE_REQUIRED', 'Missing file field `ipa`.', 400, 'Attach an IPA file and retry.');
      }

      const artifact = await context.ipaService.inspectAndStore(req.file);
      res.status(201).json({ item: artifact });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/devices', requireAuth, async (req, res, next) => {
    try {
      const mode = parseMode(req.query.mode, context.store.mode);
      const refresh = req.query.refresh === '1';
      const result = await context.deviceService.list(mode, refresh);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/install', requireAuth, async (req, res, next) => {
    try {
      const ipaId = String(req.body.ipaId ?? '');
      const deviceId = String(req.body.deviceId ?? '');
      const mode = parseMode(req.body.mode, context.store.mode);

      if (!ipaId || !deviceId) {
        throw new AppError('INSTALL_INPUT_INVALID', 'ipaId and deviceId are required.', 400, 'Select both IPA and target device.');
      }

      const job = await context.pipelineService.enqueueInstall({
        ipaId,
        deviceId,
        mode,
        confirmRealExecution: toBoolean(req.body.confirmRealExecution)
      });

      res.status(202).json({ job });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/jobs', requireAuth, (req, res, next) => {
    try {
      const filters = parseJobFilters(req.query as Record<string, unknown>);
      const allJobs = context.pipelineService.listJobs();
      const matchedJobs = filterJobs(allJobs, filters);

      const limitRequested = req.query.limit !== undefined;
      const limit = limitRequested ? parseBoundedInt(req.query.limit, 200, 1, 600) : matchedJobs.length;
      const items = matchedJobs.slice(0, Math.max(0, limit)).map((job) => sanitizeInstallJob(job));

      res.json({
        items,
        meta: {
          requestedLimit: limitRequested ? limit : null,
          returned: items.length,
          matched: matchedJobs.length,
          totalStored: allJobs.length,
          hasMore: matchedJobs.length > items.length,
          filters: buildJobFiltersMeta(filters)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/jobs/:id', requireAuth, (req, res, next) => {
    const job = context.pipelineService.getJob(req.params.id);
    if (!job) {
      next(new AppError('JOB_NOT_FOUND', 'Job not found.', 404));
      return;
    }

    const commands = context.pipelineService.listJobCommandRuns(req.params.id).map((run) => sanitizeCommandRun(run));
    res.json({ job: sanitizeInstallJob(job), commands });
  });

  app.get('/api/jobs/:id/commands', requireAuth, (req, res, next) => {
    try {
      const job = context.pipelineService.getJob(req.params.id);
      if (!job) {
        next(new AppError('JOB_NOT_FOUND', 'Job not found.', 404));
        return;
      }

      const filters = parseCommandRunFilters(req.query as Record<string, unknown>);
      const limit = parseBoundedInt(req.query.limit, 200, 1, 600);
      const includeOutput = !['0', 'false'].includes(String(req.query.includeOutput ?? '').toLowerCase());

      const allCommands = context.pipelineService.listJobCommandRuns(req.params.id, 1200);
      const matchedCommands = filterCommandRuns(allCommands, filters);

      const items = matchedCommands.slice(0, limit).map((run) => {
        const sanitized = sanitizeCommandRun(run);

        if (includeOutput) {
          return sanitized;
        }

        return {
          ...sanitized,
          stdout: undefined,
          stderr: undefined
        };
      });

      res.json({
        items,
        meta: {
          requestedLimit: limit,
          returned: items.length,
          matched: matchedCommands.length,
          totalStored: allCommands.length,
          hasMore: matchedCommands.length > items.length,
          includeOutput,
          filters: buildCommandRunFiltersMeta(filters)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/dashboard', requireAuth, async (_req, res, next) => {
    try {
      const payload = await collectDashboardPayload();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/apps/:id/refresh', requireAuth, async (req, res, next) => {
    try {
      const install = await context.schedulerService.refreshInstall(req.params.id, 'manual');
      res.json({ install });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/helper/status', requireAuthOrHelperToken, async (req, res, next) => {
    try {
      const mode = parseMode(req.query.mode, context.store.mode);
      const helperArtifact = await context.helperService.getArtifactStatus();
      const dashboard = await collectDashboardPayload();
      const devices = await context.deviceService.list(mode, true);

      const requestedDeviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
      const filteredInstalls = requestedDeviceId
        ? dashboard.installs.filter((install) => install.deviceId === requestedDeviceId)
        : dashboard.installs;

      const suggestedRefreshTarget = selectHelperRefreshTarget(filteredInstalls, {
        deviceId: requestedDeviceId
      });

      res.json({
        now: dashboard.now,
        scheduler: dashboard.scheduler,
        helperArtifact,
        mode,
        devices: devices.devices,
        installs: filteredInstalls,
        diagnostics: {
          helperInstalls: filteredInstalls.filter((install) => install.kind === 'helper').length,
          primaryInstalls: filteredInstalls.filter((install) => install.kind === 'primary').length,
          suggestedRefreshTarget: suggestedRefreshTarget
            ? {
                id: suggestedRefreshTarget.id,
                kind: suggestedRefreshTarget.kind,
                label: suggestedRefreshTarget.label,
                deviceId: suggestedRefreshTarget.deviceId,
                expiresAt: suggestedRefreshTarget.expiresAt,
                hoursRemaining: suggestedRefreshTarget.hoursRemaining
              }
            : null,
          selectionPolicy: 'Earliest-expiring primary install; fallback to earliest helper install when primary is unavailable.'
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/helper/doctor', requireAuth, async (_req, res, next) => {
    try {
      const report = await context.helperService.getDoctorReport();
      res.json(report);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/helper/refresh', requireAuthOrHelperToken, async (req, res, next) => {
    try {
      const installId = String(req.body.installId ?? '').trim();
      const deviceId = String(req.body.deviceId ?? '').trim();

      const authUser = getAuthenticatedUser(req);
      const helperTokenAuthenticated = !authUser && context.helperService.verifyToken(readHelperToken(req));

      if (helperTokenAuthenticated && !installId && !deviceId) {
        throw new AppError(
          'HELPER_REFRESH_SCOPE_REQUIRED',
          'Helper token refresh requests must include installId or deviceId.',
          400,
          'Pass installId from helper status response (recommended) or include deviceId to scope the target.'
        );
      }

      const installs = context.schedulerService.listInstalled();
      const explicitInstall = installId ? installs.find((installEntry) => installEntry.id === installId) : undefined;

      if (installId && !explicitInstall) {
        throw new AppError(
          'HELPER_REFRESH_TARGET_NOT_FOUND',
          'No install target found for helper refresh.',
          404,
          'Pass installId or deviceId for a valid installed app record.'
        );
      }

      if (explicitInstall && deviceId && explicitInstall.deviceId !== deviceId) {
        throw new AppError(
          'HELPER_REFRESH_SCOPE_CONFLICT',
          'installId and deviceId reference different install targets.',
          400,
          'Use a matching installId/deviceId pair, or provide only one scope selector.'
        );
      }

      const target =
        explicitInstall ??
        selectHelperRefreshTarget(installs, {
          deviceId: deviceId || undefined
        });

      if (!target) {
        throw new AppError(
          'HELPER_REFRESH_TARGET_NOT_FOUND',
          'No install target found for helper refresh.',
          404,
          'Pass installId or deviceId for a valid installed app record.'
        );
      }

      const install = await context.schedulerService.refreshInstall(target.id, 'helper');
      res.json({ install });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/scheduler', requireAuth, (_req, res) => {
    res.json(context.schedulerService.snapshot());
  });

  app.post('/api/scheduler/running', requireAuth, (req, res, next) => {
    try {
      if (typeof req.body.running !== 'boolean') {
        throw new AppError('SCHEDULER_RUNNING_INVALID', '`running` must be true/false.', 400);
      }

      const snapshot = context.schedulerService.setRunning(req.body.running);
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/scheduler/advance-hours', requireAuth, async (req, res, next) => {
    try {
      const hours = Number(req.body.hours ?? 0);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
        throw new AppError('SCHEDULER_ADVANCE_INVALID', 'hours must be a number between 0 and 720.', 400);
      }

      const snapshot = await context.schedulerService.advanceHours(hours, 'manual');
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/logs', requireAuth, (req, res, next) => {
    try {
      const limit = parseBoundedInt(req.query.limit, 200, 1, 600);
      const filters = parseLogFilters(req.query as Record<string, unknown>);

      const result = context.logs.query({
        limit,
        ...filters
      });

      const items = result.items.map((entry) => sanitizeLogEntry(entry));

      res.json({
        items,
        meta: {
          requestedLimit: limit,
          returned: items.length,
          matched: result.matched,
          totalStored: result.totalStored,
          hasMore: result.hasMore,
          filters: buildLogFiltersMeta(filters)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = toAppError(error);
    const safeMessage = redactSensitiveText(appError.message);
    const safeAction = appError.action ? redactSensitiveText(appError.action) : undefined;

    context.logs.push({
      level: 'error',
      code: appError.code,
      message: safeMessage,
      action: safeAction
    });

    res.status(appError.statusCode).json({
      error: {
        code: appError.code,
        message: safeMessage,
        action: safeAction
      }
    });
  });

  return { app, context };
};
