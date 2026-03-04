import { access } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { commandExists } from '../utils/command';
import { readEnv } from '../utils/env';
import { AppStore } from '../state/store';
import { HelperArtifactStatus, HelperDoctorReport } from '../types';
import { LogService } from './log-service';

interface HelperServiceConfig {
  helperToken?: string;
  helperProjectDir: string;
  helperIpaPath: string;
  helperBundleId: string;
  helperDisplayName: string;
}

const TOKEN_SETTING_KEY = 'helper_api_token';

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

export class HelperService {
  private helperToken: string;

  constructor(
    private readonly store: AppStore,
    private readonly logs: LogService,
    private readonly config: HelperServiceConfig
  ) {
    const existing = this.store.getSettingValue(TOKEN_SETTING_KEY);
    this.helperToken = config.helperToken || existing || this.createToken();

    if (!existing || existing !== this.helperToken) {
      this.store.setSettingValue(TOKEN_SETTING_KEY, this.helperToken);
    }
  }

  public getToken(): string {
    return this.helperToken;
  }

  public verifyToken(token: string | undefined): boolean {
    if (!token) {
      return false;
    }

    try {
      return timingSafeEqual(digest(token), digest(this.helperToken));
    } catch {
      return false;
    }
  }

  public rotateToken(): string {
    this.helperToken = this.createToken();
    this.store.setSettingValue(TOKEN_SETTING_KEY, this.helperToken);

    this.logs.push({
      level: 'warn',
      code: 'HELPER_TOKEN_ROTATED',
      message: 'Helper API token rotated.',
      action: 'Update token inside Sidelink Helper app settings before next refresh action.'
    });

    return this.helperToken;
  }

  public async getArtifactStatus(): Promise<HelperArtifactStatus> {
    const checkedAt = new Date().toISOString();
    const [xcodebuildAvailable, xcodegenAvailable] = await Promise.all([commandExists('xcodebuild'), commandExists('xcodegen')]);

    const ipaPath = path.resolve(this.config.helperIpaPath);
    const projectPath = path.resolve(this.config.helperProjectDir);
    const available = await pathExists(ipaPath);

    const message = available
      ? 'Helper IPA artifact detected and ready for auto-install.'
      : xcodebuildAvailable
        ? 'Helper IPA artifact missing. Build/export helper IPA or set SIDELINK_HELPER_IPA_PATH.'
        : 'xcodebuild not available. Helper source is included; build on macOS with full Xcode to produce IPA.';

    return {
      available,
      ipaPath,
      projectPath,
      bundleId: this.config.helperBundleId,
      displayName: this.config.helperDisplayName,
      xcodebuildAvailable,
      xcodegenAvailable,
      message,
      buildCommand: 'bash scripts/helper-build.sh',
      exportCommand: 'bash scripts/helper-export.sh',
      checkedAt
    };
  }

  public async getDoctorReport(): Promise<HelperDoctorReport> {
    const checkedAt = new Date().toISOString();
    const projectPath = path.resolve(this.config.helperProjectDir);
    const xcodeProjectPath = path.join(projectPath, 'SidelinkHelper.xcodeproj');
    const exportOptionsPath = path.resolve(
      readEnv('SIDELINK_HELPER_EXPORT_OPTIONS_PLIST') || path.join(projectPath, 'ExportOptions.plist')
    );
    const ipaPath = path.resolve(this.config.helperIpaPath);
    const helperArtifactDir = path.dirname(ipaPath);
    const buildScriptPath = path.resolve(process.cwd(), 'scripts/helper-build.sh');
    const exportScriptPath = path.resolve(process.cwd(), 'scripts/helper-export.sh');

    const [
      xcodebuildAvailable,
      xcodegenAvailable,
      projectDirExists,
      xcodeProjectExists,
      exportOptionsExists,
      helperIpaExists,
      buildScriptExists,
      exportScriptExists,
      artifactDirExists
    ] = await Promise.all([
      commandExists('xcodebuild'),
      commandExists('xcodegen'),
      pathExists(projectPath),
      pathExists(xcodeProjectPath),
      pathExists(exportOptionsPath),
      pathExists(ipaPath),
      pathExists(buildScriptPath),
      pathExists(exportScriptPath),
      pathExists(helperArtifactDir)
    ]);

    const readyForBuild = xcodebuildAvailable && buildScriptExists && (xcodeProjectExists || (projectDirExists && xcodegenAvailable));
    const readyForExport = readyForBuild && exportOptionsExists && exportScriptExists;
    const artifactReady = helperIpaExists;

    const checks: HelperDoctorReport['checks'] = {
      xcodebuild: {
        ok: xcodebuildAvailable,
        detail: xcodebuildAvailable ? 'xcodebuild detected.' : 'xcodebuild missing.'
      },
      xcodegen: {
        ok: xcodegenAvailable,
        detail: xcodegenAvailable ? 'xcodegen detected.' : 'xcodegen missing.'
      },
      helperProjectDir: {
        ok: projectDirExists,
        detail: projectDirExists ? 'Helper project directory found.' : 'Helper project directory not found.',
        path: projectPath
      },
      xcodeProject: {
        ok: xcodeProjectExists,
        detail: xcodeProjectExists
          ? 'Xcode project generated and ready.'
          : xcodegenAvailable
            ? 'Xcode project missing; generate via xcodegen.'
            : 'Xcode project missing and xcodegen unavailable.',
        path: xcodeProjectPath
      },
      exportOptionsPlist: {
        ok: exportOptionsExists,
        detail: exportOptionsExists ? 'Export options plist found.' : 'Export options plist missing.',
        path: exportOptionsPath
      },
      helperIpa: {
        ok: helperIpaExists,
        detail: helperIpaExists ? 'Helper IPA artifact is present.' : 'Helper IPA artifact not found.',
        path: ipaPath
      },
      buildScript: {
        ok: buildScriptExists,
        detail: buildScriptExists ? 'Helper build script is present.' : 'Helper build script is missing.',
        path: buildScriptPath
      },
      exportScript: {
        ok: exportScriptExists,
        detail: exportScriptExists ? 'Helper export script is present.' : 'Helper export script is missing.',
        path: exportScriptPath
      },
      helperArtifactDir: {
        ok: artifactDirExists,
        detail: artifactDirExists ? 'Helper artifact directory exists.' : 'Helper artifact directory does not exist.',
        path: helperArtifactDir
      }
    };

    const recommendedActions: string[] = [];

    if (!xcodebuildAvailable) {
      recommendedActions.push('Install full Xcode, open it once, and run `xcode-select --switch /Applications/Xcode.app` if needed.');
    }

    if (!projectDirExists) {
      recommendedActions.push(`Set SIDELINK_HELPER_PROJECT_DIR to a valid helper source path (current: ${projectPath}).`);
    }

    if (!xcodeProjectExists) {
      if (xcodegenAvailable && projectDirExists) {
        recommendedActions.push(`Generate project: (cd "${projectPath}" && xcodegen generate).`);
      } else {
        recommendedActions.push('Install xcodegen (`brew install xcodegen`) or commit the generated .xcodeproj.');
      }
    }

    if (!buildScriptExists) {
      recommendedActions.push(`Restore helper build script at ${buildScriptPath}.`);
    }

    if (!exportScriptExists) {
      recommendedActions.push(`Restore helper export script at ${exportScriptPath}.`);
    }

    if (!artifactDirExists) {
      recommendedActions.push(`Create helper artifact directory: mkdir -p "${helperArtifactDir}".`);
    }

    if (!exportOptionsExists) {
      recommendedActions.push(`Create ExportOptions plist at ${exportOptionsPath} (or set SIDELINK_HELPER_EXPORT_OPTIONS_PLIST).`);
    }

    if (!helperIpaExists) {
      recommendedActions.push('Run helper build/export: `bash scripts/helper-build.sh && bash scripts/helper-export.sh`.');
    }

    return {
      checkedAt,
      readyForBuild,
      readyForExport,
      artifactReady,
      checks,
      recommendedActions,
      commands: {
        generateProject: `cd "${projectPath}" && xcodegen generate`,
        build: 'bash scripts/helper-build.sh',
        export: 'bash scripts/helper-export.sh'
      }
    };
  }

  private createToken(): string {
    return randomBytes(24).toString('base64url');
  }
}
