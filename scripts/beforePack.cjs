const fs = require('node:fs');
const path = require('node:path');

const ARCH_NAMES = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal',
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyIfExists(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

exports.default = async function beforePack(context) {
  const rootDir = context.packager.projectDir;
  const platformName = context.electronPlatformName;
  const archName = ARCH_NAMES[context.arch] || process.arch;
  const exeName = process.platform === 'win32' ? 'sidelink-python.exe' : 'sidelink-python';

  const pythonBundleDir = path.join(rootDir, 'python-bundle', 'dist', `${platformName}-${archName}`);
  ensureDir(pythonBundleDir);

  const bundledPythonPath = path.join(pythonBundleDir, exeName);
  if (!fs.existsSync(bundledPythonPath)) {
    throw new Error(
      `[beforePack] Missing bundled Python helper at ${bundledPythonPath}. ` +
      'Run `npm run python:bundle` before packaging so Apple auth and device discovery are available in the desktop build.'
    );
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(bundledPythonPath, 0o755);
  }

  const helperResourcesDir = path.join(rootDir, 'resources', 'helper');
  ensureDir(helperResourcesDir);

  const helperSource = path.join(rootDir, 'tmp', 'helper', 'SidelinkHelper.ipa');
  const fallbackHelperSource = path.join(rootDir, 'helper', 'SidelinkHelper.ipa');
  const helperTarget = path.join(helperResourcesDir, 'SidelinkHelper.ipa');

  if (copyIfExists(helperSource, helperTarget)) {
    console.log(`[beforePack] Bundled helper IPA from ${helperSource}`);
  } else if (copyIfExists(fallbackHelperSource, helperTarget)) {
    console.log(`[beforePack] Bundled helper IPA from ${fallbackHelperSource}`);
  } else {
    console.log('[beforePack] No local helper IPA found; packaging without bundled helper IPA');
  }

  console.log(`[beforePack] Using bundled Python helper: ${bundledPythonPath}`);
};