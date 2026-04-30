#!/usr/bin/env node
// ─── AppleDouble sidecar purge ──────────────────────────────────────
// The repo lives on a FAT/ExFAT volume on macOS, which creates `._*`
// metadata sidecars alongside every real file on every write. The
// TypeScript language server in IDEs (and some build tools) pick these
// up and fail to parse them, producing a flood of spurious "JSX element
// implicitly has type 'any'" errors because `._index.d.ts` is not a
// module.
//
// This script hard-deletes every `._*` file under the repo (excluding
// the Python virtualenv and node_modules/electron prebuild binaries
// which have their own cleanup). Run:
//
//   • Automatically on every `npm install` via the `preinstall` hook.
//   • Automatically before dev / build via `predev` / `prebuild`.
//   • Manually via `npm run purge:sidecars`.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EXCLUDE = new Set([
  '.git',
  'node_modules/electron/dist',
  'python-bundle/.venv',
  '.venv',
  'dist/mac-arm64/SideLink.app',
  'dist/mac-x64/SideLink.app',
]);

function isExcluded(rel) {
  for (const prefix of EXCLUDE) {
    if (rel === prefix || rel.startsWith(prefix + path.sep)) return true;
  }
  return false;
}

let removed = 0;
function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);
    if (isExcluded(rel)) continue;

    if (entry.name.startsWith('._') && entry.name.length > 2) {
      try {
        fs.unlinkSync(full);
        removed++;
      } catch {
        // continue
      }
      continue;
    }
    if (entry.isDirectory()) walk(full);
  }
}

walk(ROOT);

if (removed > 0) {
  process.stdout.write(`[purge-applesidecars] removed ${removed} macOS AppleDouble sidecar(s)\n`);
}

// Set COPYFILE_DISABLE for future shell spawns inheriting from this process.
// This prevents new ._* files being created by `cp`, `tar`, and similar tools.
// (Doesn't affect Finder / editor writes — those we can't control from here.)
process.env.COPYFILE_DISABLE = '1';
