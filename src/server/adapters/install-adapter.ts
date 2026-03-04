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

    const result = await this.runAudited(
      {
        command: 'ideviceinstaller',
        args: ['-u', deviceId, '-l'],
        timeoutMs: 12_000
      },
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

    const result = await this.runAudited(
      {
        command: 'ideviceinstaller',
        args: ['-u', params.deviceId, '-i', params.signedIpaPath],
        timeoutMs: params.timeoutMs ?? 40_000
      },
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
