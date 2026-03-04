import { access } from 'node:fs/promises';
import { AppError } from '../utils/errors';
import { CommandRunner, ShellCommandRunner } from './command-runner';
import { CommandAuditWriter } from './toolchain-types';

export interface InstallExecutionParams {
  deviceId: string;
  signedIpaPath: string;
  timeoutMs?: number;
}

export interface InstallAdapter {
  ensureAvailable(): Promise<void>;
  preflightDevice(deviceId: string, audit?: CommandAuditWriter): Promise<void>;
  install(params: InstallExecutionParams, audit?: CommandAuditWriter): Promise<void>;
}

export class RealInstallAdapter implements InstallAdapter {
  constructor(private readonly runner: CommandRunner = new ShellCommandRunner()) {}

  public async ensureAvailable(): Promise<void> {
    const hasInstaller = await this.runner.exists('ideviceinstaller');
    if (hasInstaller) {
      return;
    }

    throw new AppError(
      'IDEVICEINSTALLER_MISSING',
      'Real mode requires ideviceinstaller for USB app installation.',
      400,
      'Install libimobiledevice (`brew install libimobiledevice`) and reconnect your iPhone via USB.'
    );
  }

  public async preflightDevice(deviceId: string, audit?: CommandAuditWriter): Promise<void> {
    await this.ensureAvailable();

    const result = await this.runWithInstallerCompat(
      [
        ['-u', deviceId, 'list'],
        ['list', '-u', deviceId],
        ['list', '--udid', deviceId]
      ],
      ['-u', deviceId, '-l'],
      12_000,
      audit
    );

    if (result.code !== 0) {
      throw new AppError(
        'REAL_DEVICE_PRECHECK_FAILED',
        result.stderr || result.stdout || 'Device pre-check failed.',
        400,
        'Reconnect device via USB, unlock it, tap Trust, then retry.'
      );
    }
  }

  public async install(params: InstallExecutionParams, audit?: CommandAuditWriter): Promise<void> {
    await this.ensureAvailable();

    await access(params.signedIpaPath).catch(() => {
      throw new AppError(
        'SIGNED_IPA_MISSING',
        `Signed IPA not found at ${params.signedIpaPath}.`,
        400,
        'Signing step did not produce output. Re-run the install job.'
      );
    });

    const result = await this.runWithInstallerCompat(
      [
        ['-u', params.deviceId, 'install', params.signedIpaPath],
        ['install', params.signedIpaPath, '-u', params.deviceId],
        ['install', params.signedIpaPath, '--udid', params.deviceId]
      ],
      ['-u', params.deviceId, '-i', params.signedIpaPath],
      params.timeoutMs ?? 40_000,
      audit
    );

    if (result.code !== 0) {
      throw new AppError(
        'REAL_INSTALL_EXECUTION_FAILED',
        result.stderr || result.stdout || 'Device install command failed.',
        400,
        'Check signing identity/provisioning compatibility and confirm the device remains connected + trusted.'
      );
    }
  }

  private async runWithInstallerCompat(
    modernArgVariants: string[][],
    legacyArgs: string[],
    timeoutMs: number,
    audit?: CommandAuditWriter
  ) {
    let lastModernResult: Awaited<ReturnType<RealInstallAdapter['runAudited']>> | undefined;

    for (const modernArgs of modernArgVariants) {
      const modernResult = await this.runAudited(
        {
          command: 'ideviceinstaller',
          args: modernArgs,
          timeoutMs
        },
        audit
      );

      if (modernResult.code === 0) {
        return modernResult;
      }

      if (!this.isCliSyntaxError(modernResult)) {
        return modernResult;
      }

      lastModernResult = modernResult;
    }

    const legacyResult = await this.runAudited(
      {
        command: 'ideviceinstaller',
        args: legacyArgs,
        timeoutMs
      },
      audit
    );

    if (legacyResult.code === 0) {
      return legacyResult;
    }

    if (this.isCliSyntaxError(legacyResult) && lastModernResult) {
      return lastModernResult;
    }

    return legacyResult;
  }

  private isCliSyntaxError(result: { stdout: string; stderr: string }): boolean {
    const output = `${result.stderr}\n${result.stdout}`.toLowerCase();
    return output.includes('usage: ideviceinstaller options')
      || output.includes('invalid option')
      || output.includes('unknown option')
      || output.includes('unknown command');
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
}
