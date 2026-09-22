#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { computeHelperSourceHash } = require('./write-build-manifest.cjs');
const {
  getProvenancePath,
  readHelperBundleMetadata,
  readHelperProvenance,
  sha256File,
  verifyHelperProvenance,
  writeHelperProvenance,
} = require('./write-helper-provenance.cjs');

const rootDir = path.resolve(__dirname, '..');
const projectDir = path.join(rootDir, 'ios-helper', 'SidelinkHelper');
const projectPath = path.join(projectDir, 'SidelinkHelper.xcodeproj');
const derivedDataPath = path.join(rootDir, 'tmp', 'helper', 'UnsignedDerivedData');
const stagingPath = path.join(rootDir, 'tmp', 'helper', 'unsigned-artifact');
const outputPath = path.join(rootDir, 'helper', 'SidelinkHelper.ipa');
const expectedSigning = 'unsigned-resignable';

function compareVersionParts(left, right) {
  const leftParts = String(left).split('.').map((part) => Number(part));
  const rightParts = String(right).split('.').map((part) => Number(part));
  if (leftParts.some((part) => !Number.isInteger(part) || part < 0)
    || rightParts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Helper release versions must use non-negative dot-separated integers: ${left}, ${right}`);
  }
  const count = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function assertHelperReleaseAdvanced(previous, next) {
  if (!previous
    || previous.artifactHash === next.artifactHash
    || previous.sourceHash === next.sourceHash) {
    return;
  }
  const marketingAdvanced = compareVersionParts(next.marketingVersion, previous.marketingVersion) > 0;
  const buildAdvanced = compareVersionParts(next.buildVersion, previous.buildVersion) > 0;
  if (!marketingAdvanced || !buildAdvanced) {
    throw new Error(
      'Helper sources produced a changed IPA without advancing both MARKETING_VERSION and ' +
      'CURRENT_PROJECT_VERSION. Increment the helper release identity before rebuilding.',
    );
  }
}

function readExistingHelperRelease(buildRoot, ipaPath) {
  const provenancePath = getProvenancePath(ipaPath);
  const hasArtifact = fs.existsSync(ipaPath);
  const hasProvenance = fs.existsSync(provenancePath);
  if (!hasArtifact && !hasProvenance) return null;
  if (!hasArtifact || !hasProvenance) {
    throw new Error(
      'Existing helper artifact and provenance must both be present before rebuilding. ' +
      'Restore the last known-good pair before continuing.',
    );
  }

  const provenance = readHelperProvenance(ipaPath);
  if (!provenance || !verifyHelperProvenance(
    buildRoot,
    ipaPath,
    provenance,
    provenance.sourceHash,
    expectedSigning,
  )) {
    throw new Error(
      'Existing helper artifact provenance is malformed or does not match the artifact. ' +
      'Restore the last known-good pair before continuing.',
    );
  }

  return {
    ...readHelperBundleMetadata(ipaPath),
    artifactHash: sha256File(ipaPath),
    sourceHash: provenance.sourceHash,
  };
}

function sameHelperRelease(left, right) {
  if (left === null || right === null) return left === right;
  return left.artifactHash === right.artifactHash
    && left.sourceHash === right.sourceHash
    && left.bundleIdentifier === right.bundleIdentifier
    && left.marketingVersion === right.marketingVersion
    && left.buildVersion === right.buildVersion;
}

function parseHelperProjectVersions(projectContents) {
  const readSetting = (setting) => {
    const pattern = new RegExp(`^\\s*${setting}:\\s*["']?([^\\s"'#]+)`, 'gm');
    const values = [...projectContents.matchAll(pattern)].map((match) => match[1]);
    const uniqueValues = [...new Set(values)];
    if (uniqueValues.length !== 1) {
      throw new Error(`Committed helper project must define one ${setting} value.`);
    }
    compareVersionParts(uniqueValues[0], uniqueValues[0]);
    return uniqueValues[0];
  };
  return {
    marketingVersion: readSetting('MARKETING_VERSION'),
    buildVersion: readSetting('CURRENT_PROJECT_VERSION'),
  };
}

function resolveHelperReleaseFloor(buildRoot, ipaPath, previousRelease) {
  if (!previousRelease) return null;
  const relativeIpaPath = path.relative(buildRoot, ipaPath);
  const relativeProvenancePath = path.relative(buildRoot, getProvenancePath(ipaPath));
  if ([relativeIpaPath, relativeProvenancePath].some(
    (relativePath) => relativePath.startsWith('..') || path.isAbsolute(relativePath),
  )) {
    return previousRelease;
  }

  const artifactDiff = spawnSync(
    'git',
    [
      'diff',
      '--quiet',
      'HEAD',
      '--',
      relativeIpaPath.split(path.sep).join('/'),
      relativeProvenancePath.split(path.sep).join('/'),
    ],
    { cwd: buildRoot, stdio: 'ignore' },
  );
  if (artifactDiff.error || artifactDiff.status !== 1) return previousRelease;

  const committedProject = spawnSync(
    'git',
    ['show', 'HEAD:ios-helper/SidelinkHelper/project.yml'],
    { cwd: buildRoot, encoding: 'utf8' },
  );
  if (committedProject.error || committedProject.status !== 0) return previousRelease;
  try {
    return {
      ...previousRelease,
      ...parseHelperProjectVersions(committedProject.stdout),
    };
  } catch {
    return previousRelease;
  }
}

function promoteHelperReleasePair(outputIpaPath, candidateIpaPath, validatePromoted) {
  const outputProvenancePath = getProvenancePath(outputIpaPath);
  const candidateProvenancePath = getProvenancePath(candidateIpaPath);
  const hasOutputArtifact = fs.existsSync(outputIpaPath);
  const hasOutputProvenance = fs.existsSync(outputProvenancePath);
  if (hasOutputArtifact !== hasOutputProvenance) {
    throw new Error('Existing helper artifact and provenance must both be present before promotion.');
  }
  if (!fs.existsSync(candidateIpaPath) || !fs.existsSync(candidateProvenancePath)) {
    throw new Error('Candidate helper artifact and provenance must both be present before promotion.');
  }
  const backupSuffix = `${process.pid}.${randomUUID()}.backup`;
  const backupIpaPath = `${outputIpaPath}.${backupSuffix}`;
  const backupProvenancePath = `${outputProvenancePath}.${backupSuffix}`;
  const hadPreviousArtifact = hasOutputArtifact;
  const hadPreviousProvenance = hasOutputProvenance;
  let backedUpArtifact = false;
  let backedUpProvenance = false;
  let promotedArtifact = false;
  let promotedProvenance = false;

  try {
    if (hadPreviousArtifact) {
      fs.renameSync(outputIpaPath, backupIpaPath);
      backedUpArtifact = true;
    }
    if (hadPreviousProvenance) {
      fs.renameSync(outputProvenancePath, backupProvenancePath);
      backedUpProvenance = true;
    }
    fs.renameSync(candidateIpaPath, outputIpaPath);
    promotedArtifact = true;
    fs.renameSync(candidateProvenancePath, outputProvenancePath);
    promotedProvenance = true;
    validatePromoted();
  } catch (error) {
    const rollbackErrors = [];
    for (const [wasPromoted, promotedPath] of [
      [promotedProvenance, outputProvenancePath],
      [promotedArtifact, outputIpaPath],
    ]) {
      if (!wasPromoted) continue;
      try {
        fs.rmSync(promotedPath, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const [wasBackedUp, backupPath, restoredPath] of [
      [backedUpArtifact, backupIpaPath, outputIpaPath],
      [backedUpProvenance, backupProvenancePath, outputProvenancePath],
    ]) {
      if (!wasBackedUp) continue;
      try {
        fs.renameSync(backupPath, restoredPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Helper artifact promotion failed and rollback was incomplete. Backups: ` +
        `${backupIpaPath}, ${backupProvenancePath}. Original error: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }

  for (const backupPath of [backupIpaPath, backupProvenancePath]) {
    try {
      fs.rmSync(backupPath, { force: true });
    } catch (error) {
      console.warn(`[helper:artifact] Could not remove verified backup ${backupPath}: ${error.message}`);
    }
  }
}

function finalizeHelperReleaseCandidate(
  buildRoot,
  outputIpaPath,
  candidateIpaPath,
  sourceHash,
  expectedPreviousRelease,
  releaseFloor = expectedPreviousRelease,
) {
  const candidateProvenancePath = getProvenancePath(candidateIpaPath);
  try {
    const candidateRelease = {
      ...readHelperBundleMetadata(candidateIpaPath),
      artifactHash: sha256File(candidateIpaPath),
      sourceHash,
    };
    assertHelperReleaseAdvanced(releaseFloor, candidateRelease);
    writeHelperProvenance(buildRoot, candidateIpaPath, expectedSigning, sourceHash);
    if (!verifyHelperProvenance(
      buildRoot,
      candidateIpaPath,
      undefined,
      sourceHash,
      expectedSigning,
    )) {
      throw new Error('Candidate helper artifact provenance could not be verified.');
    }
    if (computeHelperSourceHash(buildRoot) !== sourceHash) {
      throw new Error('Helper source changed before the candidate artifact could be promoted.');
    }

    const currentPreviousRelease = readExistingHelperRelease(buildRoot, outputIpaPath);
    if (!sameHelperRelease(expectedPreviousRelease, currentPreviousRelease)) {
      throw new Error('Existing helper artifact changed while its replacement was being built.');
    }

    promoteHelperReleasePair(outputIpaPath, candidateIpaPath, () => {
      if (computeHelperSourceHash(buildRoot) !== sourceHash) {
        throw new Error('Helper source changed while the candidate artifact was being promoted.');
      }
      if (!verifyHelperProvenance(
        buildRoot,
        outputIpaPath,
        undefined,
        sourceHash,
        expectedSigning,
      )) {
        throw new Error('Promoted helper artifact provenance could not be verified.');
      }
    });
    return candidateRelease;
  } catch (error) {
    fs.rmSync(candidateIpaPath, { force: true });
    fs.rmSync(candidateProvenancePath, { force: true });
    throw error;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('The unsigned iOS helper artifact can only be built on macOS with Xcode.');
  }
  const sourceHash = computeHelperSourceHash(rootDir);
  const previousRelease = readExistingHelperRelease(rootDir, outputPath);
  const releaseFloor = resolveHelperReleaseFloor(rootDir, outputPath, previousRelease);
  if (fs.existsSync(path.join(projectDir, 'project.yml'))) {
    run('xcodegen', ['generate'], { cwd: projectDir });
  }

  run('xcodebuild', [
    '-project', projectPath,
    '-scheme', 'SidelinkHelper',
    '-configuration', 'Release',
    '-destination', 'generic/platform=iOS',
    '-derivedDataPath', derivedDataPath,
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'PRODUCT_BUNDLE_IDENTIFIER=com.sidelink.ioshelper',
    'clean',
    'build',
  ]);

  const appPath = path.join(
    derivedDataPath,
    'Build',
    'Products',
    'Release-iphoneos',
    'SidelinkHelper.app',
  );
  if (!fs.existsSync(appPath)) {
    throw new Error(`Unsigned helper build did not produce ${appPath}`);
  }

  fs.rmSync(stagingPath, { recursive: true, force: true });
  const payloadPath = path.join(stagingPath, 'Payload');
  const stagedAppPath = path.join(payloadPath, 'SidelinkHelper.app');
  fs.mkdirSync(payloadPath, { recursive: true });
  fs.cpSync(appPath, stagedAppPath, { recursive: true, dereference: false });
  fs.rmSync(path.join(stagedAppPath, '_CodeSignature'), { recursive: true, force: true });
  fs.rmSync(path.join(stagedAppPath, 'embedded.mobileprovision'), { force: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const candidateOutputPath = path.join(
    path.dirname(outputPath),
    `.SidelinkHelper.${process.pid}.${randomUUID()}.candidate.ipa`,
  );
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', 'Payload', candidateOutputPath], { cwd: stagingPath });

  finalizeHelperReleaseCandidate(
    rootDir,
    outputPath,
    candidateOutputPath,
    sourceHash,
    previousRelease,
    releaseFloor,
  );
  console.log(`[helper:artifact] Wrote ${path.relative(rootDir, outputPath)}`);
}

if (require.main === module) main();

module.exports = {
  assertHelperReleaseAdvanced,
  compareVersionParts,
  finalizeHelperReleaseCandidate,
  parseHelperProjectVersions,
  promoteHelperReleasePair,
  readExistingHelperRelease,
  resolveHelperReleaseFloor,
};
