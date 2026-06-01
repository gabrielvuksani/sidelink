#!/usr/bin/env node
'use strict';

// ─── Per-Platform Python Bundle Packager ─────────────────────────────
// Wraps a PyInstaller one-dir build into a publishable npm package named
//   sidelink-python-<platform>-<arch>
// guarded by `os`/`cpu` so npm installs only the matching one as an
// optional dependency of `sidelink`. The main package resolves the binary
// at runtime via require.resolve (see src/server/utils/paths.ts).
//
// Input  : python-bundle/dist/<platform>-<arch>/sidelink-python/  (one-dir)
//          produced by `npm run python:bundle`.
// Output : packages/sidelink-python-<platform>-<arch>/
//
// Usage  : node scripts/build-python-package.cjs            # current host
//          SIDELINK_PLATFORM=linux SIDELINK_ARCH=x64 node scripts/build-python-package.cjs

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const mainPkg = require(path.join(ROOT, 'package.json'));

const PLATFORM = process.env.SIDELINK_PLATFORM || process.platform; // darwin | win32 | linux
const ARCH = process.env.SIDELINK_ARCH || process.arch;             // arm64 | x64 | ia32
const ID = `${PLATFORM}-${ARCH}`;
const PKG_NAME = `sidelink-python-${ID}`;
const EXE = PLATFORM === 'win32' ? 'sidelink-python.exe' : 'sidelink-python';

const srcOneDir = path.join(ROOT, 'python-bundle', 'dist', ID, 'sidelink-python');
const outDir = path.join(ROOT, 'packages', PKG_NAME);

function die(msg) {
  console.error(`\x1b[31m[python:package] ${msg}\x1b[0m`);
  process.exit(1);
}

if (!fs.existsSync(srcOneDir) || !fs.statSync(srcOneDir).isDirectory()) {
  die(`PyInstaller one-dir not found: ${srcOneDir}\n  Build it first: npm run python:bundle`);
}
const srcBinary = path.join(srcOneDir, EXE);
if (!fs.existsSync(srcBinary)) {
  die(`Bundle binary missing: ${srcBinary}`);
}

// Clean + copy the one-dir into the package.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.cpSync(srcOneDir, path.join(outDir, 'sidelink-python'), { recursive: true });

// Restore the executable bit (lost on some filesystems / when copying).
if (PLATFORM !== 'win32') {
  try { fs.chmodSync(path.join(outDir, 'sidelink-python', EXE), 0o755); } catch { /* best effort */ }
}

// npm os/cpu vocabulary matches process.platform/process.arch values.
const pkgJson = {
  name: PKG_NAME,
  version: mainPkg.version,
  description: `Bundled Python runtime (anisette, GSA auth, pymobiledevice3) for SideLink on ${ID}. Installed automatically as an optional dependency of "sidelink".`,
  license: mainPkg.license,
  homepage: mainPkg.homepage,
  repository: mainPkg.repository,
  os: [PLATFORM],
  cpu: [ARCH],
  main: 'index.js',
  files: ['index.js', 'sidelink-python/'],
};

const indexJs = `'use strict';
// Resolves the bundled SideLink Python binary path for this platform.
const path = require('node:path');
const exe = process.platform === 'win32' ? 'sidelink-python.exe' : 'sidelink-python';
module.exports = { binary: path.join(__dirname, 'sidelink-python', exe) };
`;

const readme = `# ${PKG_NAME}

Bundled Python runtime for **SideLink** on \`${ID}\`.

This package is published and installed automatically as an optional
dependency of [\`sidelink\`](https://www.npmjs.com/package/sidelink) — you do
not need to install it directly. npm selects it via its \`os\`/\`cpu\` fields so
only the binary matching your machine is downloaded.
`;

fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'index.js'), indexJs);
fs.writeFileSync(path.join(outDir, 'README.md'), readme);

// Report size.
function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}
const mb = (dirSize(outDir) / (1024 * 1024)).toFixed(1);
console.log(`\x1b[32m[python:package]\x1b[0m built ${PKG_NAME}@${mainPkg.version} (${mb} MB) → packages/${PKG_NAME}/`);
