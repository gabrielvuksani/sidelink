#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const bplist = require('bplist-parser');
const plist = require('plist');
const { computeHelperSourceHash } = require('./write-build-manifest.cjs');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function getProvenancePath(ipaPath) {
  return ipaPath.replace(/\.ipa$/i, '.provenance.json');
}

function readHelperProvenance(ipaPath) {
  const provenancePath = getProvenancePath(ipaPath);
  if (!fs.existsSync(provenancePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  } catch {
    return null;
  }
}

function readHelperBundleMetadata(ipaPath) {
  const archive = new AdmZip(ipaPath);
  const infoPlist = archive.getEntries().find(
    (entry) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry.entryName),
  );
  if (!infoPlist) throw new Error('Helper IPA is missing Payload/*.app/Info.plist');
  const data = infoPlist.getData();
  const parsed = data.subarray(0, 6).toString() === 'bplist'
    ? bplist.parseBuffer(data)[0]
    : plist.parse(data.toString('utf8'));
  const bundleIdentifier = parsed?.CFBundleIdentifier;
  if (typeof bundleIdentifier !== 'string' || bundleIdentifier.length === 0) {
    throw new Error('Helper IPA Info.plist is missing CFBundleIdentifier');
  }
  const marketingVersion = parsed?.CFBundleShortVersionString;
  if (typeof marketingVersion !== 'string' || marketingVersion.length === 0) {
    throw new Error('Helper IPA Info.plist is missing CFBundleShortVersionString');
  }
  const buildVersion = parsed?.CFBundleVersion;
  if (typeof buildVersion !== 'string' || buildVersion.length === 0) {
    throw new Error('Helper IPA Info.plist is missing CFBundleVersion');
  }
  return { bundleIdentifier, marketingVersion, buildVersion };
}

function readHelperBundleIdentifier(ipaPath) {
  return readHelperBundleMetadata(ipaPath).bundleIdentifier;
}

function isValidHelperProvenance(
  provenance,
  sourceHash,
  artifactHash,
  bundleMetadata,
  expectedSigning,
) {
  return provenance?.schemaVersion === 3
    && /^[a-f0-9]{64}$/.test(provenance.sourceHash)
    && /^[a-f0-9]{64}$/.test(provenance.artifactHash)
    && provenance.sourceHash === sourceHash
    && provenance.artifactHash === artifactHash
    && provenance.bundleIdentifier === bundleMetadata.bundleIdentifier
    && provenance.marketingVersion === bundleMetadata.marketingVersion
    && provenance.buildVersion === bundleMetadata.buildVersion
    && typeof provenance.signing === 'string'
    && (expectedSigning === undefined || provenance.signing === expectedSigning);
}

function verifyHelperProvenance(
  rootDir,
  ipaPath,
  provenance = readHelperProvenance(ipaPath),
  expectedSourceHash,
  expectedSigning,
) {
  if (!provenance || !fs.existsSync(ipaPath)) return false;
  try {
    const bundleMetadata = readHelperBundleMetadata(ipaPath);
    return isValidHelperProvenance(
      provenance,
      expectedSourceHash ?? computeHelperSourceHash(rootDir),
      sha256File(ipaPath),
      bundleMetadata,
      expectedSigning,
    );
  } catch {
    return false;
  }
}

function writeHelperProvenance(rootDir, ipaPath, signing, expectedSourceHash) {
  if (!fs.existsSync(ipaPath)) {
    throw new Error(`Helper IPA not found: ${ipaPath}`);
  }
  const sourceHash = computeHelperSourceHash(rootDir);
  if (expectedSourceHash && sourceHash !== expectedSourceHash) {
    throw new Error('Helper source changed while the IPA was being built; rebuild the helper artifact.');
  }
  const bundleMetadata = readHelperBundleMetadata(ipaPath);
  const provenance = {
    schemaVersion: 3,
    sourceHash,
    artifactHash: sha256File(ipaPath),
    ...bundleMetadata,
    signing,
  };
  if (computeHelperSourceHash(rootDir) !== sourceHash) {
    throw new Error('Helper source changed while provenance was being written; rebuild the helper artifact.');
  }
  const provenancePath = getProvenancePath(ipaPath);
  const temporaryPath = `${provenancePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(provenance, null, 2)}\n`);
  fs.renameSync(temporaryPath, provenancePath);
  console.log(`[helper:provenance] Wrote ${path.relative(rootDir, provenancePath)} (${provenance.sourceHash.slice(0, 12)})`);
  return provenance;
}

if (require.main === module) {
  const rootDir = path.resolve(__dirname, '..');
  const verifyOnly = process.argv[2] === '--verify';
  const ipaArgument = process.argv[verifyOnly ? 3 : 2];
  const ipaPath = ipaArgument ? path.resolve(ipaArgument) : null;
  if (!ipaPath) {
    throw new Error(
      'Usage: node scripts/write-helper-provenance.cjs <helper.ipa> [signing] [expected-source-hash]\n' +
      '   or: node scripts/write-helper-provenance.cjs --verify <helper.ipa> [expected-signing]'
    );
  }
  if (verifyOnly) {
    const expectedSigning = process.argv[4];
    if (!verifyHelperProvenance(rootDir, ipaPath, undefined, undefined, expectedSigning)) {
      throw new Error(`Helper IPA provenance is missing, stale, or invalid: ${ipaPath}`);
    }
    console.log(`[helper:provenance] Verified ${path.relative(rootDir, ipaPath)}`);
  } else {
    writeHelperProvenance(rootDir, ipaPath, process.argv[3] ?? 'unknown', process.argv[4]);
  }
}

module.exports = {
  getProvenancePath,
  isValidHelperProvenance,
  readHelperBundleIdentifier,
  readHelperBundleMetadata,
  readHelperProvenance,
  sha256File,
  verifyHelperProvenance,
  writeHelperProvenance,
};
