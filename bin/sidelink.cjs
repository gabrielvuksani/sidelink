#!/usr/bin/env node
'use strict';

// ─── SideLink CLI launcher (`npx sidelink`) ──────────────────────────
// Responsibilities, in order:
//   1. Resolve the package root + a writable OS data dir; export SIDELINK_* env.
//   2. Verify the native database module (better-sqlite3) loads — clear fix if not.
//   3. Ensure a Python runtime exists: bundled optional-dep → managed venv →
//      graceful degrade (web UI + signing still work without it).
//   4. Parse subcommands (start | doctor | setup | help | version) + flags.
//   5. Spawn the compiled server and open the browser once it is listening.
//
// This file is plain CommonJS so it runs on any Node >=20 with zero build step.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const PKG_ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(PKG_ROOT, 'package.json'));
const SERVER_ENTRY = path.join(PKG_ROOT, 'dist', 'server', 'index.js');
const SCRIPTS_DIR = path.join(PKG_ROOT, 'scripts');
const CLIENT_DIR = path.join(PKG_ROOT, 'dist', 'client');
const HELPER_IPA = path.join(PKG_ROOT, 'resources', 'helper', 'SidelinkHelper.ipa');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

// ── tiny ANSI helpers (disabled when not a TTY or NO_COLOR is set) ────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const teal = (s) => paint('36', s);
const green = (s) => paint('32', s);
const yellow = (s) => paint('33', s);
const red = (s) => paint('31', s);
const ok = (m) => console.log(`${green('✓')} ${m}`);
const warn = (m) => console.log(`${yellow('⚠')} ${m}`);
const fail = (m) => console.log(`${red('✗')} ${m}`);
const info = (m) => console.log(`  ${dim(m)}`);

// ── Data dir — mirrors getDefaultDataDir() (production branch) in
//    src/server/utils/paths.ts. Kept in sync intentionally; the launcher
//    cannot import the TypeScript source before the server starts. ──────
function resolveDataDir() {
  const envDir = process.env.SIDELINK_DATA_DIR || process.env.DATA_DIR;
  if (envDir) return path.resolve(envDir);
  const home = os.homedir();
  if (IS_MAC) return path.join(home, 'Library', 'Application Support', 'Sidelink');
  if (IS_WIN) return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Sidelink');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'sidelink');
}

const DATA_DIR = resolveDataDir();
const RUNTIME_DIR = path.join(DATA_DIR, 'runtime');
const VENV_DIR = path.join(RUNTIME_DIR, 'venv');

// Python packages the venv fallback needs. Keep in sync with
// python-bundle/requirements.txt and scripts/system-deps-preflight.cjs.
const PY_PACKAGES = [
  'anisette>=1.2.0',
  'srp==1.0.21',
  'pbkdf2>=1.3',
  'requests==2.32.3',
  'cryptography==44.0.3',
  'truststore>=0.10.0',
  'pymobiledevice3>=4.0.0',
];

// ── generic helpers ──────────────────────────────────────────────────
function which(cmd) {
  const finder = IS_WIN ? 'where' : 'which';
  const r = spawnSync(finder, [cmd], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout.trim().split(/\r?\n/)[0].trim() || null;
}

function venvPython(dir) {
  return IS_WIN ? path.join(dir, 'Scripts', 'python.exe') : path.join(dir, 'bin', 'python3');
}
function venvBin(dir, name) {
  return IS_WIN ? path.join(dir, 'Scripts', `${name}.exe`) : path.join(dir, 'bin', name);
}

// ── bundled Python (per-platform optional dependency) ────────────────
function bundlePkgName() {
  return `sidelink-python-${process.platform}-${process.arch}`;
}

function resolveBundleBinary() {
  const exe = IS_WIN ? 'sidelink-python.exe' : 'sidelink-python';
  try {
    const pkgJson = require.resolve(`${bundlePkgName()}/package.json`, { paths: [PKG_ROOT] });
    const dir = path.dirname(pkgJson);
    for (const cand of [path.join(dir, exe), path.join(dir, 'sidelink-python', exe)]) {
      if (fs.existsSync(cand)) return cand;
    }
  } catch {
    // not installed for this platform
  }
  return null;
}

// ── system Python discovery (3.10+) ──────────────────────────────────
function pythonVersionOk(bin, extraArgs) {
  const r = spawnSync(bin, [...(extraArgs || []), '--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const m = out.match(/Python 3\.(\d+)/);
  return m && parseInt(m[1], 10) >= 10;
}

function findSystemPython() {
  if (IS_MAC) {
    const brew = which('brew');
    const prefix = brew
      ? (spawnSync('brew', ['--prefix'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).stdout || '').trim() || '/opt/homebrew'
      : '/opt/homebrew';
    for (const v of ['3.13', '3.12', '3.11', '3.10']) {
      const cand = path.join(prefix, 'bin', `python${v}`);
      if (fs.existsSync(cand)) return cand;
    }
  }
  if (IS_WIN) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    for (const v of ['313', '312', '311', '310']) {
      const cand = path.join(localAppData, 'Programs', 'Python', `Python${v}`, 'python.exe');
      if (fs.existsSync(cand)) return cand;
    }
  }
  const direct = which(IS_WIN ? 'python' : 'python3');
  if (direct && pythonVersionOk(direct)) return direct;
  if (IS_WIN) {
    const py = which('py');
    if (py && pythonVersionOk(py, ['-3'])) return py;
  }
  return null;
}

// ── managed venv ─────────────────────────────────────────────────────
function venvReady() {
  return fs.existsSync(venvPython(VENV_DIR)) && fs.existsSync(venvBin(VENV_DIR, 'pymobiledevice3'));
}

function setupVenv({ force } = {}) {
  if (!force && venvReady()) return true;

  const sys = findSystemPython();
  if (!sys) {
    warn('Python 3.10+ was not found, so Apple sign-in and device install are unavailable.');
    info(IS_MAC ? 'Install: brew install python@3.13' : IS_LINUX ? 'Install: sudo apt install python3 python3-venv' : 'Install from https://www.python.org/downloads/ (check "Add to PATH").');
    info('The web UI and IPA signing still work. Re-run `sidelink setup` after installing Python.');
    return false;
  }

  console.log(`${teal('●')} Preparing the Python runtime (first run only — about a minute)…`);
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  if (force || !fs.existsSync(venvPython(VENV_DIR))) {
    const v = spawnSync(sys, ['-m', 'venv', VENV_DIR], { stdio: 'inherit' });
    if (v.status !== 0) {
      warn('Could not create the Python virtual environment.');
      if (IS_LINUX) info('You may need: sudo apt install python3-venv');
      return false;
    }
  }

  const inst = spawnSync(venvPython(VENV_DIR), ['-m', 'pip', 'install', '--disable-pip-version-check', ...PY_PACKAGES], { stdio: 'inherit' });
  if (inst.status !== 0) {
    warn('Some Python packages failed to install. Apple/device features may not work yet.');
    info(`Retry: ${venvPython(VENV_DIR)} -m pip install ${PY_PACKAGES.join(' ')}`);
    return false;
  }
  ok('Python runtime ready.');
  return true;
}

// ── native module check (better-sqlite3) ─────────────────────────────
function checkNative() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.prepare('select 1').get();
    db.close();
    return true;
  } catch (err) {
    fail('The native database module (better-sqlite3) failed to load.');
    info((err && err.message ? err.message : String(err)).split('\n')[0]);
    info(`Your Node.js is ${process.version}. Try a current LTS (Node 20 or 22), then re-run.`);
    info('Or rebuild it:  npm rebuild better-sqlite3');
    return false;
  }
}

// ── browser opener ───────────────────────────────────────────────────
function openBrowser(url) {
  try {
    if (IS_MAC) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else if (IS_WIN) spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Non-fatal: the URL is printed regardless.
  }
}

// ── arg parsing ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { command: 'start', open: true, port: undefined, host: undefined };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) {
    out.command = rest.shift();
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--no-open') out.open = false;
    else if (a === '--open') out.open = true;
    else if (a === '--port' || a === '-p') out.port = rest[++i];
    else if (a.startsWith('--port=')) out.port = a.slice(7);
    else if (a === '--host') out.host = rest[++i];
    else if (a.startsWith('--host=')) out.host = a.slice(7);
    else if (a === '--version' || a === '-v') out.command = 'version';
    else if (a === '--help' || a === '-h') out.command = 'help';
  }
  return out;
}

function printHelp() {
  console.log(`
${bold(teal('SideLink'))} ${dim('v' + pkg.version)} — personal iOS sideload manager

${bold('Usage')}
  npx sidelink ${dim('[command] [options]')}

${bold('Commands')}
  ${teal('start')}        Start the control center and open it in your browser ${dim('(default)')}
  ${teal('setup')}        Install / refresh the Python runtime, then exit
  ${teal('doctor')}       Check system dependencies and report what's missing
  ${teal('help')}         Show this help
  ${teal('version')}      Print the version

${bold('Options')} ${dim('(for start)')}
  ${teal('--port <n>')}   Preferred port ${dim('(default 4010; falls forward if busy)')}
  ${teal('--host <h>')}   Bind host ${dim('(default 0.0.0.0)')}
  ${teal('--no-open')}    Do not open the browser automatically

${bold('Data')} is stored in ${dim(DATA_DIR)}
`);
}

// ── runtime summary (shared by doctor + start banner) ────────────────
function runtimeSummary() {
  const bundle = resolveBundleBinary();
  if (bundle) return { mode: 'bundled', detail: bundle };
  if (venvReady()) return { mode: 'venv', detail: VENV_DIR };
  return { mode: 'none', detail: null };
}

function runDoctor() {
  console.log(`\n${bold('[sidelink] system check')}\n`);
  ok(`Node.js ${process.version}`);
  checkNative() && ok('Native database module (better-sqlite3)');

  const rt = runtimeSummary();
  if (rt.mode === 'bundled') ok(`Python runtime: bundled (${bundlePkgName()})`);
  else if (rt.mode === 'venv') ok(`Python runtime: managed venv (${VENV_DIR})`);
  else {
    const sys = findSystemPython();
    if (sys) warn(`Python runtime not set up yet — run \`sidelink setup\` (found ${sys}).`);
    else fail('Python 3.10+ not found — Apple sign-in and device install need it.');
  }

  // USB stack (advisory — cannot be shipped via npm)
  if (IS_MAC) ok('USB stack: usbmuxd is built into macOS');
  else if (IS_WIN) {
    const r = spawnSync('sc', ['query', 'Apple Mobile Device Service'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (r.status === 0 && /RUNNING/.test(r.stdout || '')) ok('USB stack: Apple Mobile Device Service');
    else { warn('USB stack: Apple Mobile Device Support not detected.'); info('Install iTunes (Apple site or Microsoft Store) for iOS USB drivers.'); }
  } else {
    if (which('usbmuxd') || fs.existsSync('/run/usbmuxd') || fs.existsSync('/var/run/usbmuxd')) ok('USB stack: usbmuxd');
    else { warn('USB stack: usbmuxd not detected.'); info('Install: sudo apt install usbmuxd  (or your distro equivalent)'); }
  }
  console.log('');
}

// ── start the server ─────────────────────────────────────────────────
function start(opts) {
  if (!fs.existsSync(SERVER_ENTRY)) {
    fail(`Compiled server not found at ${SERVER_ENTRY}.`);
    info('This package looks incomplete. Reinstall with: npm i -g sidelink  (or re-run npx).');
    process.exit(1);
  }
  if (!checkNative()) process.exit(1);

  // Ensure a Python runtime (bundled is instant; venv only on first run).
  const rt = runtimeSummary();
  if (rt.mode === 'bundled') ok(`Python runtime: bundled (${bundlePkgName()})`);
  else setupVenv();

  const env = {
    ...process.env,
    SIDELINK_DIST: 'npm',
    SIDELINK_APP_VERSION: pkg.version,
    SIDELINK_DATA_DIR: DATA_DIR,
    SIDELINK_SCRIPTS_DIR: SCRIPTS_DIR,
    SIDELINK_CLIENT_DIR: CLIENT_DIR,
    SIDELINK_HELPER_IPA_PATH: HELPER_IPA,
    ...(opts.port ? { SIDELINK_PORT: String(opts.port) } : {}),
    ...(opts.host ? { SIDELINK_HOST: String(opts.host) } : {}),
  };

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: PKG_ROOT,
    env,
    stdio: ['inherit', 'pipe', 'inherit'],
  });

  let opened = false;
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    if (opened || !opts.open) return;
    const m = chunk.toString('utf8').match(/listening on\s+(https?:\/\/\S+)/i);
    if (m) {
      opened = true;
      const url = m[1].replace('0.0.0.0', 'localhost').replace('[::]', 'localhost');
      console.log(`\n${teal('→')} Opening ${bold(url)} …\n`);
      openBrowser(url);
    }
  });

  const forward = (sig) => { try { child.kill(sig); } catch { /* already gone */ } };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

// ── main ─────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));
  switch (opts.command) {
    case 'version':
      console.log(pkg.version);
      return;
    case 'help':
      printHelp();
      return;
    case 'doctor':
      runDoctor();
      return;
    case 'setup':
      checkNative();
      if (resolveBundleBinary()) ok(`Python runtime already bundled (${bundlePkgName()}) — nothing to set up.`);
      else setupVenv({ force: true });
      return;
    case 'start':
    default:
      start(opts);
      return;
  }
}

main();
