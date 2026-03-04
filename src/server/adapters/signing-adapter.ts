import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../utils/errors';
import { CommandRunner, ShellCommandRunner } from './command-runner';
import { CommandAuditWriter } from './toolchain-types';

export interface SigningExecutionParams {
  ipaPath: string;
  signingIdentity: string;
  timeoutMs?: number;
}

export interface SigningExecutionResult {
  signedIpaPath: string;
  workingDir: string;
  cleanup: () => Promise<void>;
}

export interface SigningAdapter {
  ensureAvailable(): Promise<void>;
  sign(params: SigningExecutionParams, audit?: CommandAuditWriter): Promise<SigningExecutionResult>;
}

const complianceError =
  'This demo intentionally blocks enterprise/distribution/jailbreak-style flows. Use a personal Apple Development identity only.';

export class RealSigningAdapter implements SigningAdapter {
  constructor(private readonly runner: CommandRunner = new ShellCommandRunner()) {}

  public async ensureAvailable(): Promise<void> {
    const checks = await Promise.all([
      this.runner.exists('codesign'),
      this.runner.exists('security'),
      this.runner.exists('unzip'),
      this.runner.exists('zip')
    ]);

    if (checks.every(Boolean)) {
      return;
    }

    throw new AppError(
      'REAL_SIGNING_TOOLCHAIN_MISSING',
      'Real signing requires codesign, security, unzip, and zip.',
      400,
      'Install Xcode command line tools (`xcode-select --install`) and ensure zip/unzip are available.'
    );
  }

  public async sign(params: SigningExecutionParams, audit?: CommandAuditWriter): Promise<SigningExecutionResult> {
    await access(params.ipaPath).catch(() => {
      throw new AppError('IPA_FILE_MISSING', `IPA file not found at ${params.ipaPath}.`, 404, 'Upload IPA again and retry.');
    });

    this.assertIdentityCompliance(params.signingIdentity);
    await this.ensureAvailable();

    const timeoutMs = params.timeoutMs ?? 25_000;
    const identityList = await this.runAudited(
      {
        command: 'security',
        args: ['find-identity', '-v', '-p', 'codesigning'],
        timeoutMs
      },
      audit
    );

    if (identityList.code !== 0) {
      throw new AppError(
        'SIGNING_IDENTITY_DISCOVERY_FAILED',
        identityList.stderr || identityList.stdout || 'Unable to list local signing identities.',
        400,
        'Open Keychain Access and ensure an Apple Development identity is installed and trusted.'
      );
    }

    if (!identityList.stdout.toLowerCase().includes(params.signingIdentity.toLowerCase())) {
      throw new AppError(
        'SIGNING_IDENTITY_NOT_FOUND',
        `Signing identity "${params.signingIdentity}" was not found in local keychain.`,
        400,
        'Set SIDELINK_REAL_SIGNING_IDENTITY (or legacy ALTSTORE_REAL_SIGNING_IDENTITY) to an exact Apple Development identity from `security find-identity -v -p codesigning`.'
      );
    }

    const workingDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-real-sign-'));
    const unpackDir = path.join(workingDir, 'unpacked');

    try {
      await mkdir(unpackDir, { recursive: true });

      const unzipResult = await this.runAudited(
        {
          command: 'unzip',
          args: ['-q', '-o', params.ipaPath, '-d', unpackDir],
          timeoutMs
        },
        audit
      );

      if (unzipResult.code !== 0) {
        throw new AppError(
          'IPA_UNZIP_FAILED',
          unzipResult.stderr || unzipResult.stdout || 'Failed to unpack IPA archive.',
          400,
          'Verify IPA integrity, then retry.'
        );
      }

      const payloadDir = path.join(unpackDir, 'Payload');
      const payloadEntries = await readdir(payloadDir, { withFileTypes: true }).catch(() => []);
      const appDir = payloadEntries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));

      if (!appDir) {
        throw new AppError(
          'PAYLOAD_APP_NOT_FOUND',
          'Could not find Payload/<App>.app after unpacking IPA.',
          400,
          'Use a standard exported IPA from Xcode archive/export flow.'
        );
      }

      const appPath = path.join(payloadDir, appDir.name);

      const signResult = await this.runAudited(
        {
          command: 'codesign',
          args: ['-f', '--deep', '-s', params.signingIdentity, appPath],
          timeoutMs: timeoutMs * 2
        },
        audit
      );

      if (signResult.code !== 0) {
        throw new AppError(
          'REAL_SIGNING_FAILED',
          signResult.stderr || signResult.stdout || 'codesign failed.',
          400,
          'Confirm provisioning profile + entitlements match this app and signing identity.'
        );
      }

      const verifyResult = await this.runAudited(
        {
          command: 'codesign',
          args: ['--verify', '--deep', '--strict', appPath],
          timeoutMs
        },
        audit
      );

      if (verifyResult.code !== 0) {
        throw new AppError(
          'REAL_SIGNING_VERIFY_FAILED',
          verifyResult.stderr || verifyResult.stdout || 'codesign verification failed.',
          400,
          'Signing completed but verification failed. Inspect command logs for failing bundle paths.'
        );
      }

      const signedIpaPath = path.join(workingDir, 'signed.ipa');
      const zipResult = await this.runAudited(
        {
          command: 'zip',
          args: ['-qry', signedIpaPath, 'Payload'],
          cwd: unpackDir,
          timeoutMs: timeoutMs * 2
        },
        audit
      );

      if (zipResult.code !== 0) {
        throw new AppError(
          'IPA_REPACK_FAILED',
          zipResult.stderr || zipResult.stdout || 'Failed to re-pack signed IPA.',
          400,
          'Inspect disk permissions and free space, then retry.'
        );
      }

      return {
        signedIpaPath,
        workingDir,
        cleanup: async () => {
          await rm(workingDir, { recursive: true, force: true });
        }
      };
    } catch (error) {
      await rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async runAudited(
    invocation: { command: string; args: string[]; timeoutMs?: number; cwd?: string },
    audit?: CommandAuditWriter
  ) {
    const result = await this.runner.execute({
      command: invocation.command,
      args: invocation.args,
      timeoutMs: invocation.timeoutMs,
      cwd: invocation.cwd
    });

    if (audit) {
      await audit({
        command: result.command,
        args: result.args,
        cwd: result.cwd,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        exitCode: result.code,
        status: result.code === 0 ? 'success' : 'error',
        stdout: result.stdout,
        stderr: result.stderr
      });
    }

    return result;
  }

  private assertIdentityCompliance(identity: string): void {
    const normalized = identity.toLowerCase();

    if (normalized.includes('enterprise') || normalized.includes('in-house') || normalized.includes('distribution')) {
      throw new AppError('NON_COMPLIANT_SIGNING_IDENTITY', `Identity "${identity}" is blocked. ${complianceError}`, 400, complianceError);
    }

    if (!/(apple development|iphone developer)/i.test(identity)) {
      throw new AppError(
        'UNSUPPORTED_SIGNING_IDENTITY',
        `Identity "${identity}" is not an Apple Development identity.`,
        400,
        complianceError
      );
    }
  }
}
