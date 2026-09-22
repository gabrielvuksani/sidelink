#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const asar = require('@electron/asar');
const bplist = require('bplist-parser');
const plist = require('plist');

const {
  canonicalizeSignedExecutable,
  collectFiles,
  hashNamedContents,
  normalizePath,
} = require('./build-manifest/executable-integrity.cjs');
const {
  computePackagedRuntimeDependencyHash,
  computeRuntimeDependencySourceHash,
  expectedPackagedDependencyContent,
} = require('./build-manifest/dependency-integrity.cjs');

const HELPER_PROJECT_INPUTS = [
  ['project.yml', 'ios-helper/SidelinkHelper/project.yml'],
  ['ExportOptions.plist', 'ios-helper/SidelinkHelper/ExportOptions.plist'],
  ['Sources/App', 'ios-helper/SidelinkHelper/Sources/App'],
];

const HELPER_TOOL_INPUTS = [
  'scripts/build-helper-artifact.cjs',
  'scripts/helper-export.sh',
  'scripts/write-helper-provenance.cjs',
];

const HELPER_SOURCE_INPUTS = [
  ...HELPER_PROJECT_INPUTS.map(([, logicalPath]) => logicalPath),
  ...HELPER_TOOL_INPUTS,
];

const SOURCE_INPUTS = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'vite.config.ts',
  'src',
  'build/entitlements.mac.plist',
  'build/icons',
  ...HELPER_SOURCE_INPUTS,
  'helper/SidelinkHelper.provenance.json',
  'python-bundle/build.py',
  'python-bundle/entry.py',
  'python-bundle/requirements-bootstrap.in',
  'python-bundle/requirements-bootstrap.lock',
  'python-bundle/requirements-build.in',
  'python-bundle/requirements-build.lock',
  'python-bundle/requirements.lock',
  'python-bundle/requirements.txt',
  'scripts/anisette-helper.py',
  'scripts/generate-icon-assets.py',
  'scripts/gsa-auth-helper.py',
  'scripts/beforePack.cjs',
  'scripts/afterPack.cjs',
  'scripts/build.cjs',
  'scripts/build-python-bundle.cjs',
  'scripts/build-manifest/dependency-integrity.cjs',
  'scripts/build-manifest/executable-integrity.cjs',
  'scripts/helper-build.sh',
  'scripts/smoke-packaged-app.cjs',
  'scripts/verify-lock-integrity.cjs',
  'scripts/windows-process-tree.cjs',
  'scripts/windows-sign.cjs',
  'scripts/write-build-manifest.cjs',
];

const COMPILED_OUTPUTS = [
  'dist/client',
  'dist/desktop',
  'dist/server',
  'dist/shared',
];

const ASAR_COMPILED_OUTPUTS = [
  'dist/desktop',
  'dist/server',
  'dist/shared',
];

const PACKAGED_PACKAGE_JSON_KEYS = new Set([
  'name',
  'version',
  'private',
  'description',
  'author',
  'license',
  'homepage',
  'repository',
  'engines',
  'packageManager',
  'overrides',
  'main',
  'dependencies',
]);

const SOURCE_EXCLUDES = [
  'src/client/dist',
];

const PACKAGED_RUNTIME_RECEIPT_SCHEMA_VERSION = 1;

function collectRequiredInputs(rootDir, inputs) {
  const entries = [];
  const includeSourcePath = (entryName) => !SOURCE_EXCLUDES.some(
    (excluded) => entryName === excluded || entryName.startsWith(`${excluded}/`),
  );
  for (const input of inputs) {
    collectFiles(path.join(rootDir, input), normalizePath(input), entries, includeSourcePath);
  }
  return entries;
}

function isPathWithinTree(treeRoot, candidatePath) {
  const relativePath = path.relative(treeRoot, candidatePath);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
}

function encodeResourceNode(type, mode, payload = Buffer.alloc(0)) {
  const typeCodes = { missing: 0, file: 1, directory: 2, symlink: 3 };
  const header = Buffer.allocUnsafe(5);
  header.writeUInt8(typeCodes[type], 0);
  header.writeUInt32BE(mode & 0o7777, 1);
  return Buffer.concat([header, payload]);
}

function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseCodeResources(content) {
  try {
    const parsed = content.subarray(0, 8).toString('ascii') === 'bplist00'
      ? bplist.parseBuffer(content)[0]
      : plist.parse(content.toString('utf8'));
    if (!isObjectRecord(parsed)) return null;
    const hasFiles = ['files', 'files2'].some((key) => isObjectRecord(parsed[key]));
    const hasRules = ['rules', 'rules2'].some((key) => isObjectRecord(parsed[key]));
    return hasFiles && hasRules ? parsed : null;
  } catch {
    return null;
  }
}

const MACHO_MAGICS = new Set([
  'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca',
  'feedface', 'cefaedfe', 'feedfacf', 'cffaedfe',
]);

function canonicalizePlatformSignedExecutable(content, platform) {
  if (content.length < 4) return content;
  if (platform === 'darwin' && MACHO_MAGICS.has(content.subarray(0, 4).toString('hex'))) {
    return canonicalizeSignedExecutable(content);
  }
  if (platform === 'win32' && content[0] === 0x4d && content[1] === 0x5a) {
    return canonicalizeSignedExecutable(content);
  }
  return content;
}

function isCanonicalMacCodeSignatureDirectory(absolutePath, stat, platform) {
  if (platform !== 'darwin' || !stat.isDirectory() || path.basename(absolutePath) !== '_CodeSignature') {
    return false;
  }
  const children = fs.readdirSync(absolutePath, { withFileTypes: true });
  if (children.length !== 1 || children[0].name !== 'CodeResources' || !children[0].isFile()) {
    return false;
  }
  return parseCodeResources(fs.readFileSync(path.join(absolutePath, 'CodeResources'))) !== null;
}

function validateResourceSymlink(treeRoot, realTreeRoot, absolutePath, entryName, linkTarget) {
  if (path.isAbsolute(linkTarget)) {
    throw new Error(`Unsafe resource symlink must use a relative target: ${entryName} -> ${linkTarget}`);
  }
  const lexicalTarget = path.resolve(path.dirname(absolutePath), linkTarget);
  if (!isPathWithinTree(treeRoot, lexicalTarget)) {
    throw new Error(`Resource symlink escapes the resource tree: ${entryName} -> ${linkTarget}`);
  }

  let realTarget;
  try {
    realTarget = fs.realpathSync(absolutePath);
  } catch (error) {
    if (error?.code === 'ELOOP') {
      throw new Error(`Cyclic resource symlink: ${entryName} -> ${linkTarget}`);
    }
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new Error(`Broken resource symlink: ${entryName} -> ${linkTarget}`);
    }
    throw error;
  }
  if (!isPathWithinTree(realTreeRoot, realTarget)) {
    throw new Error(`Resource symlink resolves outside the resource tree: ${entryName} -> ${linkTarget}`);
  }
}

function collectResourceNode(
  absolutePath,
  entryName,
  treeRoot,
  realTreeRoot,
  entries,
  include,
  options,
) {
  const normalizedEntryName = normalizePath(entryName);
  if (!include(normalizedEntryName)) return;
  const stat = fs.lstatSync(absolutePath);
  if (isCanonicalMacCodeSignatureDirectory(absolutePath, stat, options.platform)) return;
  const mode = stat.mode & 0o7777;
  if (stat.isDirectory()) {
    entries.push({
      name: normalizedEntryName,
      content: encodeResourceNode('directory', mode),
    });
    for (const child of fs.readdirSync(absolutePath).sort()) {
      collectResourceNode(
        path.join(absolutePath, child),
        `${entryName}/${child}`,
        treeRoot,
        realTreeRoot,
        entries,
        include,
        options,
      );
    }
    return;
  }
  if (stat.isFile()) {
    const content = canonicalizePlatformSignedExecutable(
      fs.readFileSync(absolutePath),
      options.platform,
    );
    entries.push({
      name: normalizedEntryName,
      content: encodeResourceNode('file', mode, content),
    });
    return;
  }
  if (stat.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(absolutePath);
    validateResourceSymlink(treeRoot, realTreeRoot, absolutePath, normalizedEntryName, linkTarget);
    entries.push({
      name: normalizedEntryName,
      content: encodeResourceNode('symlink', mode, Buffer.from(linkTarget, 'utf8')),
    });
    return;
  }
  throw new Error(`Unsupported resource node type: ${normalizedEntryName}`);
}

function collectOptionalTree(absolutePath, prefix, entries, include, options) {
  let rootStat;
  try {
    rootStat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    entries.push({ name: prefix, content: encodeResourceNode('missing', 0) });
    return;
  }
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Resource tree root must not be a symlink: ${prefix}`);
  }
  const treeRoot = path.resolve(absolutePath);
  const realTreeRoot = fs.realpathSync(absolutePath);
  collectResourceNode(
    absolutePath,
    prefix,
    treeRoot,
    realTreeRoot,
    entries,
    (entryName) => include?.(entryName) ?? true,
    options,
  );
}

function computeBuildSourceHash(rootDir) {
  return hashNamedContents(collectRequiredInputs(rootDir, SOURCE_INPUTS));
}

function computeHelperSourceHash(rootDir, options = {}) {
  const projectDir = options.projectDir ?? path.join(rootDir, 'ios-helper', 'SidelinkHelper');
  const exportOptionsPath = options.exportOptionsPath ?? path.join(projectDir, 'ExportOptions.plist');
  const entries = [];
  for (const [projectPath, logicalPath] of HELPER_PROJECT_INPUTS) {
    const absolutePath = projectPath === 'ExportOptions.plist'
      ? exportOptionsPath
      : path.join(projectDir, projectPath);
    collectFiles(absolutePath, logicalPath, entries);
  }
  for (const input of HELPER_TOOL_INPUTS) {
    collectFiles(path.join(rootDir, input), input, entries);
  }
  return hashNamedContents(entries);
}

function computeCompiledOutputHash(rootDir) {
  return hashNamedContents(collectRequiredInputs(rootDir, COMPILED_OUTPUTS));
}

function isCompiledOutputPath(entryName) {
  return COMPILED_OUTPUTS.some(
    (output) => entryName === output || entryName.startsWith(`${output}/`),
  );
}

function isAsarCompiledOutputPath(entryName) {
  return ASAR_COMPILED_OUTPUTS.some(
    (output) => entryName === output || entryName.startsWith(`${output}/`),
  );
}

function computePackagedCompiledOutputHash(asarPath, resourcesDir) {
  if (!resourcesDir) {
    throw new Error('Packaged resources directory is required to verify compiled output');
  }
  const entries = [];
  for (const archiveEntry of asar.listPackage(asarPath)) {
    const entryName = archiveEntry.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (!isAsarCompiledOutputPath(entryName)) continue;
    const info = asar.statFile(asarPath, entryName);
    if ('files' in info) continue;
    if ('link' in info) throw new Error(`Unexpected symlink in packaged compiled output: ${entryName}`);
    entries.push({ name: entryName, content: asar.extractFile(asarPath, entryName) });
  }
  collectFiles(path.join(resourcesDir, 'client'), 'dist/client', entries);
  return hashNamedContents(entries);
}

function expectedPackagedPackageJson(rootDir) {
  const workspacePackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  return Object.fromEntries(
    Object.entries(workspacePackage).filter(([key]) => PACKAGED_PACKAGE_JSON_KEYS.has(key)),
  );
}

function isAllowedPackagedApplicationFile(entryName) {
  return entryName === 'package.json'
    || entryName === 'dist/build-manifest.json'
    || isAsarCompiledOutputPath(entryName)
    || entryName.startsWith('node_modules/');
}

function verifyPackagedApplicationContents(rootDir, asarPath) {
  const unexpectedFiles = [];
  for (const archiveEntry of asar.listPackage(asarPath)) {
    const entryName = archiveEntry.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const info = asar.statFile(asarPath, entryName);
    if ('files' in info) continue;
    if (!isAllowedPackagedApplicationFile(entryName)) unexpectedFiles.push(entryName);
  }
  if (unexpectedFiles.length > 0) {
    throw new Error(`Unexpected packaged application file: ${unexpectedFiles.sort()[0]}`);
  }

  const packagedPackage = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  const expectedPackage = expectedPackagedPackageJson(rootDir);
  if (!isDeepStrictEqual(packagedPackage, expectedPackage)) {
    throw new Error('Packaged package.json does not match the expected runtime metadata');
  }
  return true;
}

function computePackagedResourceHash(resourcesDir, options = {}) {
  return hashOptionalTrees([
    { absolutePath: path.join(resourcesDir, 'python'), prefix: 'python' },
    { absolutePath: path.join(resourcesDir, 'helper'), prefix: 'helper' },
    { absolutePath: path.join(resourcesDir, 'icons'), prefix: 'icons' },
    { absolutePath: path.join(resourcesDir, 'client'), prefix: 'client' },
    { absolutePath: path.join(resourcesDir, 'scripts'), prefix: 'scripts' },
  ], options);
}

function hashOptionalTrees(trees, options = {}) {
  const entries = [];
  const resolvedOptions = { platform: options.platform ?? process.platform };
  for (const tree of trees) {
    collectOptionalTree(tree.absolutePath, tree.prefix, entries, tree.include, resolvedOptions);
  }
  return hashNamedContents(entries);
}

function computePackageResourceHash(rootDir, options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  return hashOptionalTrees([
    { absolutePath: path.join(rootDir, 'python-bundle', 'dist', `${platform}-${arch}`), prefix: 'python' },
    { absolutePath: path.join(rootDir, 'resources', 'helper'), prefix: 'helper' },
    { absolutePath: path.join(rootDir, 'build', 'icons'), prefix: 'icons' },
    { absolutePath: path.join(rootDir, 'dist', 'client'), prefix: 'client' },
    {
      absolutePath: path.join(rootDir, 'scripts'),
      prefix: 'scripts',
      include: (entryName) => entryName === 'scripts' || entryName.endsWith('.py'),
    },
  ], { platform });
}

function resolvePackagedApplicationRoot(executablePath, options = {}) {
  const platform = options.platform ?? process.platform;
  const resolvedExecutablePath = path.resolve(executablePath);
  const executableStat = fs.lstatSync(resolvedExecutablePath);
  if (!executableStat.isFile()) {
    throw new Error(`Packaged executable must be a regular file: ${resolvedExecutablePath}`);
  }

  if (platform !== 'darwin') return path.dirname(resolvedExecutablePath);

  let candidate = path.dirname(resolvedExecutablePath);
  while (true) {
    if (path.basename(candidate).endsWith('.app')) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Packaged macOS executable is not inside an application bundle: ${resolvedExecutablePath}`);
}

function packagedRuntimeIntegrityReceiptPath(packageRoot) {
  return path.join(
    path.dirname(packageRoot),
    `${path.basename(packageRoot)}.runtime-integrity.json`,
  );
}

function computePackagedRuntimeHash(packageRoot, options = {}) {
  const resolvedPackageRoot = path.resolve(packageRoot);
  const rootStat = fs.lstatSync(resolvedPackageRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Packaged application root must be a real directory: ${resolvedPackageRoot}`);
  }
  return hashOptionalTrees([{
    absolutePath: resolvedPackageRoot,
    prefix: 'package',
  }], { platform: options.platform ?? process.platform });
}

function buildManifestFileHash(rootDir, expectedManifest) {
  const manifestPath = path.join(rootDir, 'dist', 'build-manifest.json');
  const content = fs.readFileSync(manifestPath);
  const parsed = JSON.parse(content.toString('utf8'));
  if (!isDeepStrictEqual(parsed, expectedManifest)) {
    throw new Error('The workspace build manifest changed before packaged runtime integrity was recorded');
  }
  return hashNamedContents([{ name: 'dist/build-manifest.json', content }]);
}

function packagedExecutableRelativePath(packageRoot, executablePath) {
  const relativePath = path.relative(packageRoot, executablePath);
  if (
    relativePath === ''
    || relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    throw new Error(`Packaged executable is outside the application root: ${executablePath}`);
  }
  return normalizePath(relativePath);
}

function writePackagedRuntimeIntegrityReceipt(
  rootDir,
  executablePath,
  expectedManifest,
  options = {},
) {
  const platform = options.platform ?? expectedManifest.platform ?? process.platform;
  if (expectedManifest.platform !== platform) {
    throw new Error(`Packaged runtime platform ${platform} does not match the build manifest`);
  }
  const packageRoot = resolvePackagedApplicationRoot(executablePath, { platform });
  const receiptPath = packagedRuntimeIntegrityReceiptPath(packageRoot);
  const receipt = {
    schemaVersion: PACKAGED_RUNTIME_RECEIPT_SCHEMA_VERSION,
    platform,
    arch: expectedManifest.arch,
    executablePath: packagedExecutableRelativePath(packageRoot, executablePath),
    buildManifestHash: buildManifestFileHash(rootDir, expectedManifest),
    packagedRuntimeHash: computePackagedRuntimeHash(packageRoot, { platform }),
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return { ...receipt, receiptPath };
}

function verifyPackagedRuntimeIntegrityReceipt(
  rootDir,
  executablePath,
  expectedManifest,
  options = {},
) {
  const platform = options.platform ?? expectedManifest.platform ?? process.platform;
  const packageRoot = resolvePackagedApplicationRoot(executablePath, { platform });
  const receiptPath = packagedRuntimeIntegrityReceiptPath(packageRoot);
  const receiptStat = fs.lstatSync(receiptPath);
  if (!receiptStat.isFile() || receiptStat.isSymbolicLink()) {
    throw new Error(`Packaged runtime integrity receipt must be a regular file: ${receiptPath}`);
  }
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const expectedExecutablePath = packagedExecutableRelativePath(packageRoot, executablePath);
  if (
    receipt.schemaVersion !== PACKAGED_RUNTIME_RECEIPT_SCHEMA_VERSION
    || receipt.platform !== platform
    || receipt.arch !== expectedManifest.arch
    || receipt.executablePath !== expectedExecutablePath
    || !/^[a-f0-9]{64}$/.test(receipt.buildManifestHash ?? '')
    || !/^[a-f0-9]{64}$/.test(receipt.packagedRuntimeHash ?? '')
  ) {
    throw new Error(`Invalid packaged runtime integrity receipt: ${receiptPath}`);
  }
  if (receipt.buildManifestHash !== buildManifestFileHash(rootDir, expectedManifest)) {
    throw new Error('The packaged runtime integrity receipt does not match the workspace build manifest');
  }
  const actualRuntimeHash = computePackagedRuntimeHash(packageRoot, { platform });
  if (receipt.packagedRuntimeHash !== actualRuntimeHash) {
    throw new Error('The packaged outer runtime tree changed after packaging or during final signing');
  }
  return true;
}

function writeBuildManifest(rootDir, options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const outputPath = path.join(rootDir, 'dist', 'build-manifest.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const sourceHash = computeBuildSourceHash(rootDir);
  const compiledHash = computeCompiledOutputHash(rootDir);
  if (options.expectedSourceHash && options.expectedSourceHash !== sourceHash) {
    throw new Error('Source files changed while the desktop build was running; restart the build.');
  }
  if (options.expectedCompiledHash && options.expectedCompiledHash !== compiledHash) {
    throw new Error('Compiled files changed after the desktop build completed; restart the build.');
  }
  const manifest = {
    schemaVersion: 2,
    platform,
    arch,
    sourceHash,
    compiledHash,
    resourceHash: computePackageResourceHash(rootDir, { platform, arch }),
    runtimeDependencyHash: computeRuntimeDependencySourceHash(rootDir, { platform }),
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[build:manifest] Wrote ${path.relative(rootDir, outputPath)} (${manifest.sourceHash.slice(0, 12)})`);
  return manifest;
}

if (require.main === module) {
  throw new Error('Build manifests must be created by scripts/build.cjs or the desktop packaging hook.');
}

module.exports = {
  HELPER_SOURCE_INPUTS,
  SOURCE_INPUTS,
  canonicalizeSignedExecutable,
  computeBuildSourceHash,
  computeCompiledOutputHash,
  computeHelperSourceHash,
  computePackageResourceHash,
  computePackagedCompiledOutputHash,
  computePackagedResourceHash,
  computePackagedRuntimeHash,
  computePackagedRuntimeDependencyHash,
  computeRuntimeDependencySourceHash,
  expectedPackagedPackageJson,
  expectedPackagedDependencyContent,
  hashNamedContents,
  hashOptionalTrees,
  isCompiledOutputPath,
  packagedRuntimeIntegrityReceiptPath,
  resolvePackagedApplicationRoot,
  verifyPackagedApplicationContents,
  verifyPackagedRuntimeIntegrityReceipt,
  writeBuildManifest,
  writePackagedRuntimeIntegrityReceipt,
};
