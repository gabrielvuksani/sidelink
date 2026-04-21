#!/usr/bin/env node
// ─── Source Feed Generator ──────────────────────────────────────────
// Scans docs/source/apps/ for IPA files, extracts metadata from each,
// merges optional companion JSON overrides, and regenerates the
// AltStore-compatible docs/source/source.json manifest.
//
// Usage:  npm run source:generate
//         node scripts/generate-source.cjs
//
// To add an app:
//   1. Drop MyApp.ipa into docs/source/apps/
//   2. (Optional) Create MyApp.json next to it with metadata overrides
//   3. Run npm run source:generate (or keep npm run source:watch running)
//
// Companion JSON schema  (all fields optional):
// {
//   "name":                 "Display Name",
//   "developerName":        "Your Name",
//   "subtitle":             "Short tagline",
//   "localizedDescription": "Full description",
//   "iconURL":              "https://…/icon.png",
//   "tintColor":            "#1f9fbf",
//   "featured":             true,
//   "versionDate":          "2026-03-08",
//   "versionDescription":   "What's new",
//   "appPermissions": {
//     "entitlements": [],
//     "privacy": []
//   }
// }

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const bplistParser = require('bplist-parser');

// ── Paths ───────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'docs', 'source', 'apps');
const SOURCE_OUT = path.join(ROOT, 'docs', 'source', 'source.json');
const SOURCE_COPY = path.join(ROOT, 'docs', 'source.json');
const HELPER_IPA = path.join(ROOT, 'helper', 'SidelinkHelper.ipa');

// ── Constants ───────────────────────────────────────────────────────
const GITHUB_REPO = 'gabrielvuksani/sidelink';
const DOWNLOAD_BASE = `https://github.com/${GITHUB_REPO}/releases/latest/download`;
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/main`;
const DEFAULT_ICON = `${RAW_BASE}/build/icons/icon-1024.png`;

function toIsoDate(input) {
  if (!input) return null;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

function compareVersionParts(left, right) {
  const leftParts = String(left)
    .split(/[^0-9A-Za-z]+/)
    .filter(Boolean);
  const rightParts = String(right)
    .split(/[^0-9A-Za-z]+/)
    .filter(Boolean);
  const len = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < len; index += 1) {
    const leftPart = leftParts[index] ?? '0';
    const rightPart = rightParts[index] ?? '0';
    const leftNum = Number(leftPart);
    const rightNum = Number(rightPart);
    const leftIsNum = Number.isFinite(leftNum) && /^\d+$/.test(leftPart);
    const rightIsNum = Number.isFinite(rightNum) && /^\d+$/.test(rightPart);

    if (leftIsNum && rightIsNum) {
      if (leftNum !== rightNum) return leftNum - rightNum;
      continue;
    }

    const cmp = leftPart.localeCompare(rightPart, undefined, { numeric: true, sensitivity: 'base' });
    if (cmp !== 0) return cmp;
  }

  return 0;
}

function compareVersionEntries(left, right) {
  const versionCmp = compareVersionParts(right.version, left.version);
  if (versionCmp !== 0) return versionCmp;

  const dateCmp = String(right.date || '').localeCompare(String(left.date || ''));
  if (dateCmp !== 0) return dateCmp;

  return String(right.downloadURL || '').localeCompare(String(left.downloadURL || ''));
}

// ── Source-level metadata (rarely changes) ──────────────────────────
const SOURCE_SHELL = {
  name: 'SideLink Official',
  identifier: 'com.sidelink.official',
  subtitle: 'Official SideLink Source',
  description: 'Official feed for SideLink-compatible IPA releases and curated apps.',
  iconURL: DEFAULT_ICON,
  headerURL: DEFAULT_ICON,
  website: `https://github.com/${GITHUB_REPO}`,
  tintColor: '#1f9fbf',
  sourceURL: `${RAW_BASE}/docs/source/source.json`,
};

// ── Hardcoded SideLink helper entry ─────────────────────────────────
function buildHelperEntry(size) {
  return {
    name: 'SideLink',
    bundleIdentifier: 'com.sidelink.ioshelper',
    developerName: 'SideLink',
    subtitle: 'Manage sideloaded apps from your iPhone',
    localizedDescription:
      'The official SideLink companion app for iOS. Browse source catalogs, import your own IPAs, install apps, monitor refresh status, and manage AltStore-compatible feeds directly from your device.',
    iconURL: DEFAULT_ICON,
    tintColor: '#1f9fbf',
    versions: [
      {
        version: '0.1.0',
        date: '2026-03-06',
        localizedDescription:
          'Introduces a redesigned iPhone experience with a home feed, dedicated search, installed-app import tools, re-auth visibility, and upgraded onboarding.',
        downloadURL: `${DOWNLOAD_BASE}/SidelinkHelper.ipa`,
        size,
      },
    ],
    appPermissions: {
      entitlements: ['com.apple.security.application-groups'],
      privacy: [
        'LocalNetwork: Discover and pair with the SideLink desktop helper on your network',
        'Notifications: Receive background refresh status updates',
      ],
    },
  };
}

// ── Plist parsing (binary or XML) ───────────────────────────────────
function parsePlist(buf) {
  // Binary plist starts with "bplist"
  if (buf[0] === 0x62 && buf[1] === 0x70) {
    const parsed = bplistParser.parseBuffer(buf);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  }
  const plist = require('plist');
  return plist.parse(buf.toString('utf8'));
}

// ── Extract metadata from an IPA ────────────────────────────────────
function extractIpaMetadata(ipaPath) {
  const zip = new AdmZip(ipaPath);
  const entries = zip.getEntries();

  const plistEntry = entries.find(
    (e) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(e.entryName) && !e.isDirectory,
  );
  if (!plistEntry) {
    throw new Error(`No Info.plist found in ${path.basename(ipaPath)}`);
  }

  const info = parsePlist(plistEntry.getData());
  const bundleId = String(info.CFBundleIdentifier || '');
  const name = String(info.CFBundleDisplayName || info.CFBundleName || '');
  const version = String(info.CFBundleShortVersionString || info.CFBundleVersion || '1.0.0');
  const size = fs.statSync(ipaPath).size;

  if (!bundleId) {
    throw new Error(`Missing CFBundleIdentifier in ${path.basename(ipaPath)}`);
  }

  return { bundleId, name: name || bundleId.split('.').pop() || 'App', version, size };
}

// ── Build an app entry from metadata + overrides ────────────────────
function buildVersionEntry(meta, filename, overrides, fileStat) {
  return {
    version: meta.version,
    date: overrides.versionDate || toIsoDate(fileStat.mtime) || new Date().toISOString().split('T')[0],
    localizedDescription: overrides.versionDescription || `Version ${meta.version}`,
    downloadURL: `${DOWNLOAD_BASE}/${filename}`,
    size: meta.size,
  };
}

/**
 * Reject companion-JSON URLs that don't use https:. An untrusted companion
 * JSON could otherwise inject `javascript:`, `data:`, or attacker-controlled
 * `http://` URLs into the published source feed that are then loaded by the
 * AltStore/SideLink clients consuming the manifest. Returns the URL when
 * safe, or throws with a clear message so the generate step fails loudly.
 */
function assertHttpsUrl(value, field, filename) {
  if (value === undefined || value === null || value === '') return value;
  const str = String(value);
  try {
    const parsed = new URL(str);
    if (parsed.protocol !== 'https:') {
      throw new Error(`${filename}: '${field}' must use https:// (got ${parsed.protocol})`);
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`${filename}: '${field}' is not a valid URL: ${str}`);
    }
    throw err;
  }
  return str;
}

function buildAppShell(meta, overrides, filename) {
  const iconURL = assertHttpsUrl(overrides.iconURL, 'iconURL', filename) || DEFAULT_ICON;
  const entry = {
    name: overrides.name || meta.name,
    bundleIdentifier: meta.bundleId,
    developerName: overrides.developerName || 'Unknown',
    subtitle: overrides.subtitle || '',
    localizedDescription: overrides.localizedDescription || '',
    iconURL,
    tintColor: overrides.tintColor || '#1f9fbf',
    versions: [],
  };

  if (overrides.appPermissions) {
    entry.appPermissions = overrides.appPermissions;
  }

  return entry;
}

function upsertAppEntry(appsByBundle, meta, filename, overrides, fileStat, featuredApps) {
  const nextVersion = buildVersionEntry(meta, filename, overrides, fileStat);
  const nextShell = buildAppShell(meta, overrides, filename);
  const existing = appsByBundle.get(meta.bundleId);

  if (!existing) {
    nextShell.versions.push(nextVersion);
    appsByBundle.set(meta.bundleId, nextShell);
    if (overrides.featured) featuredApps.add(meta.bundleId);
    return;
  }

  const hasSameAsset = existing.versions.some((version) => version.downloadURL === nextVersion.downloadURL);
  if (!hasSameAsset) {
    existing.versions.push(nextVersion);
  }

  existing.versions.sort(compareVersionEntries);

  const currentPrimary = existing.versions[0];
  if (currentPrimary && currentPrimary.downloadURL === nextVersion.downloadURL) {
    existing.name = nextShell.name;
    existing.developerName = nextShell.developerName;
    existing.subtitle = nextShell.subtitle;
    existing.localizedDescription = nextShell.localizedDescription;
    existing.iconURL = nextShell.iconURL;
    existing.tintColor = nextShell.tintColor;
    if (nextShell.appPermissions) {
      existing.appPermissions = nextShell.appPermissions;
    } else {
      delete existing.appPermissions;
    }
  }

  if (overrides.featured) featuredApps.add(meta.bundleId);
}

function generateSourceFeed() {
  fs.mkdirSync(APPS_DIR, { recursive: true });

  const apps = [];
  const featuredApps = new Set();
  const appsByBundle = new Map();

  // 1. Built-in SideLink helper (always included, always first)
  if (fs.existsSync(HELPER_IPA)) {
    const size = fs.statSync(HELPER_IPA).size;
    apps.push(buildHelperEntry(size));
    featuredApps.add('com.sidelink.ioshelper');
    console.log('  ✓ SideLink helper (built-in)');
  } else {
    console.warn('  ⚠ helper/SidelinkHelper.ipa not found — skipping built-in entry');
  }

  // 2. Scan docs/source/apps/ for user IPAs
  const ipaFiles = fs.readdirSync(APPS_DIR).filter((f) => f.toLowerCase().endsWith('.ipa'));

  for (const file of ipaFiles) {
    const ipaPath = path.join(APPS_DIR, file);
    const baseName = path.basename(file, path.extname(file));
    const overridePath = path.join(APPS_DIR, `${baseName}.json`);

    try {
      const meta = extractIpaMetadata(ipaPath);
      const fileStat = fs.statSync(ipaPath);

      let overrides = {};
      if (fs.existsSync(overridePath)) {
        overrides = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
        console.log(`  ✓ ${file} + ${baseName}.json → ${meta.bundleId} v${meta.version}`);
      } else {
        console.log(`  ✓ ${file} → ${meta.bundleId} v${meta.version}`);
      }

      upsertAppEntry(appsByBundle, meta, file, overrides, fileStat, featuredApps);
    } catch (err) {
      console.error(`  ✗ ${file}: ${err.message}`);
      process.exit(1);
    }
  }

  const bundledApps = Array.from(appsByBundle.values())
    .map((entry) => ({
      ...entry,
      versions: entry.versions.sort(compareVersionEntries),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

  apps.push(...bundledApps);

  // 3. Assemble the full source manifest
  const source = {
    ...SOURCE_SHELL,
    featuredApps: Array.from(featuredApps),
    news: [
      {
        identifier: 'official-feed',
        title: 'SideLink Official Source',
        caption:
          'The official feed is generated from docs/source/apps so committed IPAs publish automatically with the docs site.',
        date: '2026-03-06',
        tintColor: '#1f9fbf',
        notify: true,
        url: `https://github.com/${GITHUB_REPO}/tree/main/docs/source/apps`,
      },
    ],
    apps,
  };

  // 4. Write both copies
  const json = JSON.stringify(source, null, 2) + '\n';
  fs.writeFileSync(SOURCE_OUT, json, 'utf8');
  fs.writeFileSync(SOURCE_COPY, json, 'utf8');

  console.log(`\n  → ${apps.length} app(s) written to docs/source/source.json`);
  return source;
}

function watchSourceFeed() {
  let pending = null;

  const trigger = (reason) => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      console.log(`\n👀 Change detected (${reason}). Regenerating source feed…\n`);
      generateSourceFeed();
      console.log('');
    }, 200);
  };

  generateSourceFeed();
  console.log('👀 Watching docs/source/apps for IPA and metadata changes…\n');

  fs.watch(APPS_DIR, (eventType, filename) => {
    if (!filename) {
      trigger(eventType);
      return;
    }

    const lower = String(filename).toLowerCase();
    if (!lower.endsWith('.ipa') && !lower.endsWith('.json')) {
      return;
    }

    trigger(`${eventType}:${filename}`);
  });
}

const watchMode = process.argv.includes('--watch');

console.log(`\n${watchMode ? '👀 Watching source feed…' : '🔄 Generating source feed…'}\n`);
if (watchMode) {
  watchSourceFeed();
} else {
  generateSourceFeed();
  console.log('');
}
