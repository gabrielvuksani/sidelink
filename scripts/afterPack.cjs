// ─── electron-builder afterPack hook ────────────────────────────────
// Generates app-update.yml in the packaged app's resources directory.
// electron-builder skips this file for --dir builds, which causes
// electron-updater to throw ENOENT at runtime. This hook ensures
// the update manifest is always present.

const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const buildConfig = packager.config;
  const publish = buildConfig.publish;

  if (!publish) {
    console.log('[afterPack] No publish config — skipping app-update.yml generation');
    return;
  }

  // Normalize publish config (can be string, object, or array)
  const pub = typeof publish === 'string'
    ? { provider: publish }
    : Array.isArray(publish) ? publish[0] : publish;

  if (!pub || !pub.provider) {
    console.log('[afterPack] No valid publish provider — skipping');
    return;
  }

  // Build the YAML content
  const lines = [`provider: ${pub.provider}`];
  if (pub.owner) lines.push(`owner: ${pub.owner}`);
  if (pub.repo) lines.push(`repo: ${pub.repo}`);
  if (pub.url) lines.push(`url: ${pub.url}`);
  if (pub.channel) lines.push(`channel: ${pub.channel}`);
  lines.push(`updaterCacheDirName: ${buildConfig.appId || 'sidelink'}-updater`);

  const yaml = lines.join('\n') + '\n';

  // Determine the resources directory based on platform
  let resourcesDir;
  if (context.electronPlatformName === 'darwin') {
    // macOS: <appOutDir>/<productName>.app/Contents/Resources
    const appName = packager.appInfo.productFilename || packager.appInfo.productName || 'SideLink';
    resourcesDir = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    // Windows/Linux: <appOutDir>/resources
    resourcesDir = path.join(appOutDir, 'resources');
  }

  const ymlPath = path.join(resourcesDir, 'app-update.yml');

  // Don't overwrite if electron-builder already generated it
  if (fs.existsSync(ymlPath)) {
    console.log('[afterPack] app-update.yml already exists');
    return;
  }

  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(ymlPath, yaml, 'utf8');
  console.log(`[afterPack] Generated ${ymlPath}`);
};
