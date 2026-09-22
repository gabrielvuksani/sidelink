const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const {
  canonicalizeSignedExecutable,
  collectFiles,
  hashNamedContents,
  normalizePath,
} = require('./executable-integrity.cjs');

const NODE_MODULE_EXCLUDED_NAMES = new Set([
  '.DS_Store', '.circleci', '.eslintrc', '.flowconfig', '.git', '.gitattributes', '.github', '.gitignore',
  '.gitkeep', '.hg', '.husky', '.idea', '.jshintrc', '.npmignore', '.nyc_output', '.svn', '.travis.yml',
  '.vs', '.yarn-integrity', '.yarn-metadata.json', 'CVS', 'RCS', 'SCCS',
  'CHANGELOG.md', 'ChangeLog', 'Changelog', 'Changelog.md', '__pycache__', 'appveyor.yml',
  'binding.gyp', 'bun.lock', 'bun.lockb', 'changelog.md', 'circle.yml', 'electron-builder.env',
  'node_gyp_bins', 'node_modules', 'npm-debug.log', 'package-lock.json', 'pnpm-lock.yaml',
  'thumbs.db', 'yarn-error.log', 'yarn.lock',
]);
const NODE_MODULE_TOP_LEVEL_EXCLUDES = new Set([
  '.bin', '.coveralls.yml', 'README', 'README.md', 'Readme', 'Readme.md', '__tests__', 'example',
  'examples', 'karma.conf.js', 'powered-test', 'readme', 'readme.markdown', 'readme.md', 'test', 'tests',
]);
const NODE_MODULE_EXCLUDED_EXTENSIONS = [
  '.a', '.cc', '.csproj', '.d.ts', '.forge-meta', '.hprof', '.iml', '.mk', '.o', '.obj', '.orig',
  '.pdb', '.pyc', '.pyo', '.rbc', '.sln', '.suo', '.swp', '.xproj',
];
const PACKAGED_DEPENDENCY_IGNORED_PROPERTIES = new Set([
  'dist',
  'gitHead',
  'build',
  'jspm',
  'ava',
  'xo',
  'nyc',
  'eslintConfig',
  'contributors',
  'bundleDependencies',
  'tags',
]);

function expectedPackagedDependencyContent(entryName, content) {
  if (!entryName.endsWith('/package.json')) return canonicalizeSignedExecutable(content);

  const data = JSON.parse(content.toString('utf8'));
  const dependencies = data.dependencies;
  const removeBabel = dependencies !== null
    && typeof dependencies === 'object'
    && !Object.getOwnPropertyNames(dependencies).some((name) => name.startsWith('babel'));
  let changed = false;
  for (const property of Object.getOwnPropertyNames(data)) {
    if (
      property.startsWith('_')
      || PACKAGED_DEPENDENCY_IGNORED_PROPERTIES.has(property)
      || property === 'scripts'
      || property === 'keywords'
      || property === 'bugs'
      || (removeBabel && property === 'babel')
    ) {
      delete data[property];
      changed = true;
    }
  }
  return changed ? Buffer.from(JSON.stringify(data, null, 2)) : content;
}

function dependencyPackageCandidates(fromPackagePath, dependencyName) {
  const candidates = [];
  let currentPath = fromPackagePath;
  while (true) {
    candidates.push(currentPath
      ? `${currentPath}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`);
    if (!currentPath) break;
    const nestedIndex = currentPath.lastIndexOf('/node_modules/');
    currentPath = nestedIndex >= 0
      ? currentPath.slice(0, nestedIndex)
      : '';
  }
  return candidates;
}

function resolveDependencyPackagePath(packageCollection, fromPackagePath, dependencyName) {
  return dependencyPackageCandidates(fromPackagePath, dependencyName).find((candidate) => (
    packageCollection instanceof Map
      ? packageCollection.has(candidate)
      : Object.prototype.hasOwnProperty.call(packageCollection, candidate)
  )) ?? null;
}

function readProductionPackageInventory(rootDir) {
  const lockPath = path.join(rootDir, 'package-lock.json');
  const packagePath = path.join(rootDir, 'package.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json does not contain an installed package inventory');
  }

  const packages = [];
  const queuedPaths = [];
  const seenPaths = new Set();
  const enqueueDependency = (fromPackagePath, dependencyName, optional) => {
    const dependencyPath = resolveDependencyPackagePath(lock.packages, fromPackagePath, dependencyName);
    if (!dependencyPath || !fs.existsSync(path.join(rootDir, dependencyPath))) {
      if (optional) return;
      throw new Error(`Production dependency is missing from the installed lock tree: ${dependencyName}`);
    }
    queuedPaths.push(dependencyPath);
  };

  const rootOptionalDependencies = new Set(Object.keys(packageJson.optionalDependencies ?? {}));
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    enqueueDependency('', dependencyName, rootOptionalDependencies.has(dependencyName));
  }
  for (const dependencyName of rootOptionalDependencies) {
    if (!(dependencyName in (packageJson.dependencies ?? {}))) {
      enqueueDependency('', dependencyName, true);
    }
  }

  while (queuedPaths.length > 0) {
    const packageEntry = queuedPaths.shift();
    if (seenPaths.has(packageEntry)) continue;
    seenPaths.add(packageEntry);
    const metadata = lock.packages[packageEntry];
    const installedPackagePath = path.join(rootDir, packageEntry, 'package.json');
    if (!metadata || !fs.existsSync(installedPackagePath)) {
      throw new Error(`Missing installed production dependency: ${packageEntry}`);
    }
    const installedPackage = JSON.parse(fs.readFileSync(installedPackagePath, 'utf8'));
    if (metadata.version !== undefined && installedPackage.version !== metadata.version) {
      throw new Error(`Installed dependency version does not match package-lock.json: ${packageEntry}`);
    }
    packages.push({
      path: packageEntry,
      name: installedPackage.name,
      version: installedPackage.version ?? metadata.version ?? null,
    });

    const optionalDependencies = new Set(Object.keys(metadata.optionalDependencies ?? {}));
    for (const dependencyName of Object.keys(metadata.dependencies ?? {})) {
      enqueueDependency(packageEntry, dependencyName, optionalDependencies.has(dependencyName));
    }
    for (const dependencyName of optionalDependencies) {
      if (!(dependencyName in (metadata.dependencies ?? {}))) {
        enqueueDependency(packageEntry, dependencyName, true);
      }
    }
  }

  return packages.sort((left, right) => left.path.localeCompare(right.path));
}

function shouldIncludeRuntimeDependencyPath(relativePath, packageName, platform) {
  const parts = normalizePath(relativePath).split('/');
  if (parts.some((part) => NODE_MODULE_EXCLUDED_NAMES.has(part) || part.startsWith('._'))) return false;
  if (NODE_MODULE_TOP_LEVEL_EXCLUDES.has(parts[0])) return false;
  const name = parts.at(-1);
  const excludedExtensions = platform === 'win32'
    ? NODE_MODULE_EXCLUDED_EXTENSIONS
    : [...NODE_MODULE_EXCLUDED_EXTENSIONS, '.dll', '.exe'];
  if (excludedExtensions.some((extension) => name.endsWith(extension))) return false;
  const parentName = parts.at(-2);
  if (parentName === 'build' && (
    name === 'gyp-mac-tool' || name === 'Makefile' || name.endsWith('.mk')
    || name.endsWith('.gypi') || name.endsWith('.Makefile')
  )) return false;
  if (parentName === 'Release' && (name === '.deps' || name === 'obj.target')) return false;
  if (parts[0] === 'src' && (packageName === 'keytar' || packageName === 'keytar-prebuild')) return false;
  if ((parts[0] === 'build' || parts[0] === 'deps') && packageName === 'lzma-native') return false;
  return true;
}

function collectRuntimeDependencyEntries(rootDir, options = {}) {
  const inventory = readProductionPackageInventory(rootDir);
  const platform = options.platform ?? process.platform;
  const entries = [{
    name: 'package-lock.production.json',
    content: Buffer.from(JSON.stringify(inventory)),
  }];
  for (const packageEntry of inventory) {
    const packageRoot = path.join(rootDir, packageEntry.path);
    collectFiles(packageRoot, packageEntry.path, entries, (entryName) => {
      const relativePath = normalizePath(path.relative(packageRoot, path.join(rootDir, entryName)));
      return relativePath === '' || shouldIncludeRuntimeDependencyPath(relativePath, packageEntry.name, platform);
    });
  }
  return { entries, inventory };
}

function computeRuntimeDependencySourceHash(rootDir, options = {}) {
  const { entries } = collectRuntimeDependencyEntries(rootDir, options);
  return hashNamedContents(entries);
}

function packageIdentity(packageEntry) {
  return `${packageEntry.name}@${packageEntry.version ?? ''}`;
}

function collectExpectedPackageArtifacts(rootDir, inventory, platform) {
  const artifacts = new Map();
  for (const packageEntry of inventory) {
    const packageRoot = path.join(rootDir, packageEntry.path);
    const packageFiles = [];
    collectFiles(packageRoot, packageEntry.path, packageFiles, (entryName) => {
      const relativePath = normalizePath(path.relative(packageRoot, path.join(rootDir, entryName)));
      return relativePath === ''
        || shouldIncludeRuntimeDependencyPath(relativePath, packageEntry.name, platform);
    });
    const files = new Map(packageFiles.map((entry) => {
      const relativePath = entry.name.slice(packageEntry.path.length + 1);
      return [
        relativePath,
        expectedPackagedDependencyContent(entry.name, entry.content),
      ];
    }));
    const identity = packageIdentity(packageEntry);
    const existing = artifacts.get(identity);
    if (existing) {
      const sameFiles = existing.files.size === files.size
        && [...files].every(([relativePath, content]) => existing.files.get(relativePath)?.equals(content));
      if (!sameFiles) {
        throw new Error(`Installed copies of ${identity} do not have identical runtime bytes`);
      }
    } else {
      artifacts.set(identity, { files });
    }
  }
  return artifacts;
}

function addExpectedDependencyEdge(edges, parentIdentity, dependencyName, childIdentity) {
  let parentEdges = edges.get(parentIdentity);
  if (!parentEdges) {
    parentEdges = new Map();
    edges.set(parentIdentity, parentEdges);
  }
  let allowedIdentities = parentEdges.get(dependencyName);
  if (!allowedIdentities) {
    allowedIdentities = new Set();
    parentEdges.set(dependencyName, allowedIdentities);
  }
  allowedIdentities.add(childIdentity);
}

function buildExpectedDependencyEdges(rootDir, inventory) {
  const lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const inventoryByPath = new Map(inventory.map((entry) => [entry.path, entry]));
  const edges = new Map();
  const addEdge = (parentPath, parentIdentity, dependencyName, optional) => {
    const dependencyPath = resolveDependencyPackagePath(lock.packages, parentPath, dependencyName);
    const child = dependencyPath ? inventoryByPath.get(dependencyPath) : null;
    if (!child) {
      if (optional) return;
      throw new Error(`Production dependency edge is missing from the lock inventory: ${dependencyName}`);
    }
    addExpectedDependencyEdge(edges, parentIdentity, dependencyName, packageIdentity(child));
  };

  const rootOptionalDependencies = new Set(Object.keys(packageJson.optionalDependencies ?? {}));
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    addEdge('', '<root>', dependencyName, rootOptionalDependencies.has(dependencyName));
  }
  for (const dependencyName of rootOptionalDependencies) {
    if (!(dependencyName in (packageJson.dependencies ?? {}))) {
      addEdge('', '<root>', dependencyName, true);
    }
  }
  for (const packageEntry of inventory) {
    const metadata = lock.packages[packageEntry.path];
    const optionalDependencies = new Set(Object.keys(metadata.optionalDependencies ?? {}));
    for (const dependencyName of Object.keys(metadata.dependencies ?? {})) {
      addEdge(
        packageEntry.path,
        packageIdentity(packageEntry),
        dependencyName,
        optionalDependencies.has(dependencyName),
      );
    }
    for (const dependencyName of optionalDependencies) {
      if (!(dependencyName in (metadata.dependencies ?? {}))) {
        addEdge(packageEntry.path, packageIdentity(packageEntry), dependencyName, true);
      }
    }
  }
  return edges;
}

const PACKAGED_PACKAGE_ROOT_PATTERN = /^(node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*)\/package\.json$/;

function readPackagedPackageRoots(asarPath, expectedArtifacts) {
  const packagedRoots = new Map();
  for (const archiveEntry of asar.listPackage(asarPath)) {
    const entryName = archiveEntry.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const match = PACKAGED_PACKAGE_ROOT_PATTERN.exec(entryName);
    if (!match) continue;
    const packageJson = JSON.parse(asar.extractFile(asarPath, entryName).toString('utf8'));
    const identity = packageIdentity(packageJson);
    if (!expectedArtifacts.has(identity)) {
      throw new Error(`Packaged dependency is not in the production lock graph: ${identity}`);
    }
    packagedRoots.set(match[1], { identity, packageJson });
  }
  return packagedRoots;
}

function validatePackagedDependencyGraph(rootDir, packagedRoots, expectedEdges) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const reachableRoots = new Set();
  const queuedRoots = [];
  const resolveEdge = (fromRoot, parentIdentity, dependencyName, optional) => {
    const childRoot = resolveDependencyPackagePath(packagedRoots, fromRoot, dependencyName);
    if (!childRoot) {
      if (optional) return;
      throw new Error(`Packaged dependency graph cannot resolve ${dependencyName} from ${parentIdentity}`);
    }
    const child = packagedRoots.get(childRoot);
    const allowedIdentities = expectedEdges.get(parentIdentity)?.get(dependencyName);
    if (!allowedIdentities?.has(child.identity)) {
      throw new Error(`Packaged dependency graph resolves ${dependencyName} from ${parentIdentity} to unexpected ${child.identity}`);
    }
    queuedRoots.push(childRoot);
  };

  const rootOptionalDependencies = new Set(Object.keys(packageJson.optionalDependencies ?? {}));
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    resolveEdge('', '<root>', dependencyName, rootOptionalDependencies.has(dependencyName));
  }
  for (const dependencyName of rootOptionalDependencies) {
    if (!(dependencyName in (packageJson.dependencies ?? {}))) {
      resolveEdge('', '<root>', dependencyName, true);
    }
  }
  while (queuedRoots.length > 0) {
    const packageRoot = queuedRoots.shift();
    if (reachableRoots.has(packageRoot)) continue;
    reachableRoots.add(packageRoot);
    const packagedPackage = packagedRoots.get(packageRoot);
    const optionalDependencies = new Set(Object.keys(packagedPackage.packageJson.optionalDependencies ?? {}));
    for (const dependencyName of Object.keys(packagedPackage.packageJson.dependencies ?? {})) {
      resolveEdge(
        packageRoot,
        packagedPackage.identity,
        dependencyName,
        optionalDependencies.has(dependencyName),
      );
    }
    for (const dependencyName of optionalDependencies) {
      if (!(dependencyName in (packagedPackage.packageJson.dependencies ?? {}))) {
        resolveEdge(packageRoot, packagedPackage.identity, dependencyName, true);
      }
    }
  }

  const unreachableRoot = [...packagedRoots.keys()].find((packageRoot) => !reachableRoots.has(packageRoot));
  if (unreachableRoot) {
    throw new Error(`Packaged dependency is unreachable from the application dependency graph: ${unreachableRoot}`);
  }
}

function computePackagedRuntimeDependencyHash(rootDir, asarPath, options = {}) {
  const { inventory } = collectRuntimeDependencyEntries(rootDir, options);
  const platform = options.platform ?? process.platform;
  const expectedArtifacts = collectExpectedPackageArtifacts(rootDir, inventory, platform);
  const expectedEdges = buildExpectedDependencyEdges(rootDir, inventory);
  const packagedRoots = readPackagedPackageRoots(asarPath, expectedArtifacts);
  const remainingIdentities = new Set(expectedArtifacts.keys());
  const remainingFilesByRoot = new Map();
  for (const [packageRoot, packagedPackage] of packagedRoots) {
    remainingIdentities.delete(packagedPackage.identity);
    remainingFilesByRoot.set(
      packageRoot,
      new Set(expectedArtifacts.get(packagedPackage.identity).files.keys()),
    );
  }
  if (remainingIdentities.size > 0) {
    throw new Error(`Production dependency is missing from the packaged app: ${remainingIdentities.values().next().value}`);
  }

  const packageRootsByLength = [...packagedRoots.keys()].sort((left, right) => right.length - left.length);
  const entries = [];
  for (const archiveEntry of asar.listPackage(asarPath)) {
    const entryName = archiveEntry.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (!entryName.startsWith('node_modules/')) continue;
    const info = asar.statFile(asarPath, entryName);
    if ('files' in info) continue;
    if (entryName === 'node_modules/.package-lock.json') continue;
    const packageRoot = packageRootsByLength.find(
      (candidate) => entryName.startsWith(`${candidate}/`),
    );
    if (!packageRoot) {
      throw new Error(`Packaged dependency file is outside a package root: ${entryName}`);
    }
    if ('link' in info) {
      throw new Error(`Unexpected symlink in packaged production dependency: ${entryName}`);
    }

    const packagedPackage = packagedRoots.get(packageRoot);
    const relativePath = entryName.slice(packageRoot.length + 1);
    const expectedContent = expectedArtifacts.get(packagedPackage.identity).files.get(relativePath);
    if (!expectedContent) {
      throw new Error(`Packaged dependency file is not part of the expected production artifact: ${entryName}`);
    }
    const packagedContent = canonicalizeSignedExecutable(asar.extractFile(asarPath, entryName));
    if (!packagedContent.equals(expectedContent)) {
      throw new Error(`Packaged dependency bytes do not match the current install: ${entryName}`);
    }
    remainingFilesByRoot.get(packageRoot).delete(relativePath);
    entries.push({ name: entryName, content: packagedContent });
  }

  for (const [packageRoot, remainingFiles] of remainingFilesByRoot) {
    if (remainingFiles.size > 0) {
      throw new Error(`Production dependency file is missing from the packaged app: ${packageRoot}/${remainingFiles.values().next().value}`);
    }
  }
  validatePackagedDependencyGraph(rootDir, packagedRoots, expectedEdges);
  if (entries.length === 0) {
    throw new Error('The packaged app contains no production dependency files');
  }
  entries.push({ name: 'package-lock.production.json', content: Buffer.from(JSON.stringify(inventory)) });
  return hashNamedContents(entries);
}

module.exports = {
  computePackagedRuntimeDependencyHash,
  computeRuntimeDependencySourceHash,
  expectedPackagedDependencyContent,
};
