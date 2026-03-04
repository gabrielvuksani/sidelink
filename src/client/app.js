const state = {
  mode: 'demo',
  ipas: [],
  devices: { devices: [], source: 'mock', note: '' },
  jobs: [],
  dashboard: {
    installs: [],
    scheduler: {
      running: true,
      simulatedNow: new Date().toISOString(),
      tickIntervalMs: 6000,
      simulatedHoursPerTick: 6,
      autoRefreshThresholdHours: 48
    },
    counts: {
      installs: 0,
      expiring: 0,
      expired: 0,
      helperInstalls: 0
    }
  },
  overview: null,
  settings: null,
  helperStatus: null,
  helperDoctor: null,
  logs: [],
  logsMeta: null,
  logLevelFilter: 'all',
  logSearch: '',
  commandRuns: [],
  selectedJobId: '',
  commandStatusFilter: 'all',
  commandSearch: '',
  auth: {
    authenticated: false,
    user: null
  },
  pending: {
    auth: false,
    mode: false,
    upload: false,
    install: false,
    refresh: false,
    scheduler: false,
    helper: false,
    commands: false,
    manualRefresh: false,
    supportSnapshot: false,
    logs: false
  }
};

const el = {
  quickStats: document.getElementById('quickStats'),
  onboardingHint: document.getElementById('onboardingHint'),
  modePills: document.getElementById('modePills'),
  kpiGrid: document.getElementById('kpiGrid'),
  refreshAll: document.getElementById('refreshAll'),

  modeDemo: document.getElementById('modeDemo'),
  modeReal: document.getElementById('modeReal'),
  uploadForm: document.getElementById('uploadForm'),
  ipaInput: document.getElementById('ipaInput'),
  uploadError: document.getElementById('uploadError'),
  ipaSelect: document.getElementById('ipaSelect'),
  deviceSelect: document.getElementById('deviceSelect'),
  confirmRealExecution: document.getElementById('confirmRealExecution'),
  runInstall: document.getElementById('runInstall'),
  refreshDevices: document.getElementById('refreshDevices'),
  pipelineSafetyHint: document.getElementById('pipelineSafetyHint'),

  deviceSource: document.getElementById('deviceSource'),
  deviceList: document.getElementById('deviceList'),
  ipaList: document.getElementById('ipaList'),

  jobList: document.getElementById('jobList'),
  commandJobSelect: document.getElementById('commandJobSelect'),
  loadCommands: document.getElementById('loadCommands'),
  commandStatusFilter: document.getElementById('commandStatusFilter'),
  commandSearch: document.getElementById('commandSearch'),
  commandList: document.getElementById('commandList'),

  installList: document.getElementById('installList'),
  schedulerMeta: document.getElementById('schedulerMeta'),
  toggleScheduler: document.getElementById('toggleScheduler'),
  advance6: document.getElementById('advance6'),
  advance24: document.getElementById('advance24'),

  helperSummary: document.getElementById('helperSummary'),
  helperDoctor: document.getElementById('helperDoctor'),
  runHelperDoctor: document.getElementById('runHelperDoctor'),
  rotateHelperToken: document.getElementById('rotateHelperToken'),

  logList: document.getElementById('logList'),
  logLevelFilter: document.getElementById('logLevelFilter'),
  logSearch: document.getElementById('logSearch'),
  downloadSupportSnapshot: document.getElementById('downloadSupportSnapshot'),
  toastRack: document.getElementById('toastRack'),

  loginForm: document.getElementById('loginForm'),
  loginUsername: document.getElementById('loginUsername'),
  loginPassword: document.getElementById('loginPassword'),
  sessionPanel: document.getElementById('sessionPanel'),
  sessionLabel: document.getElementById('sessionLabel'),
  logoutBtn: document.getElementById('logoutBtn'),
  authError: document.getElementById('authError')
};

const badge = (text, tone = 'info') => `<span class="badge ${tone}">${text}</span>`;
const statPill = (label, value) => `<span class="stat-pill"><strong>${value}</strong> ${label}</span>`;
const empty = (message = 'No records yet.') => `<div class="empty">${message}</div>`;
const humanizeToken = (token) =>
  String(token || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

let toastCounter = 0;

const showToast = (message, tone = 'info') => {
  if (!el.toastRack) {
    return;
  }

  const item = document.createElement('div');
  const id = `toast_${toastCounter++}`;
  item.className = `toast ${tone}`;
  item.setAttribute('data-toast-id', id);
  item.textContent = message;

  el.toastRack.appendChild(item);

  setTimeout(() => {
    item.classList.add('fade-out');
    setTimeout(() => {
      item.remove();
    }, 240);
  }, 2800);
};

const withPending = async (key, task) => {
  state.pending[key] = true;
  renderAll();

  try {
    return await task();
  } finally {
    state.pending[key] = false;
    renderAll();
  }
};

const formatDateTime = (iso) => {
  if (!iso) return 'n/a';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
};

const durationBetween = (startIso, endIso) => {
  if (!startIso || !endIso) {
    return undefined;
  }

  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return undefined;
  }

  return end - start;
};

const formatDurationMs = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) {
    return 'n/a';
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem}s`;
};

const buildSnapshotFilename = (generatedAt) => {
  const raw = typeof generatedAt === 'string' && generatedAt.trim() ? generatedAt : new Date().toISOString();
  return `sidelink-support-${raw.replace(/[:.]/g, '-')}.json`;
};

const downloadJsonFile = (payload, filename) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const toneForHealth = (health) => {
  if (health === 'healthy') return 'success';
  if (health === 'expiring' || health === 'refreshing') return 'warn';
  if (health === 'expired') return 'error';
  return 'info';
};

const toneForStatus = (status) => {
  if (status === 'success') return 'success';
  if (status === 'error') return 'error';
  if (status === 'running') return 'warn';
  return 'info';
};

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      state.auth.authenticated = false;
      state.auth.user = null;
      clearProtectedState();
      renderAll();
    }

    const err = payload?.error;
    throw new Error(err?.action ? `${err.message} — ${err.action}` : err?.message || `Request failed (${response.status})`);
  }

  return payload;
};

const requireAuth = () => {
  if (!state.auth.authenticated) {
    throw new Error('Sign in required for this action.');
  }
};

const clearProtectedState = () => {
  state.ipas = [];
  state.devices = { devices: [], source: 'mock', note: '' };
  state.jobs = [];
  state.dashboard = {
    installs: [],
    scheduler: {
      running: true,
      simulatedNow: new Date().toISOString(),
      tickIntervalMs: 6000,
      simulatedHoursPerTick: 6,
      autoRefreshThresholdHours: 48
    },
    counts: {
      installs: 0,
      expiring: 0,
      expired: 0,
      helperInstalls: 0
    }
  };
  state.overview = null;
  state.settings = null;
  state.helperDoctor = null;
  state.logs = [];
  state.logsMeta = null;
  state.logLevelFilter = 'all';
  state.logSearch = '';
  state.commandRuns = [];
  state.selectedJobId = '';
};

const renderAuth = () => {
  const isAuthed = state.auth.authenticated;
  const realModeBlockedByMockSource = state.mode === 'real' && state.devices.source !== 'real';
  const authBusy = state.pending.auth;
  const modeBusy = state.pending.mode;
  const installBusy = state.pending.install;
  const refreshBusy = state.pending.refresh;
  const helperBusy = state.pending.helper;
  const hasInstallInputs = state.ipas.length > 0 && state.devices.devices.length > 0;

  el.loginForm.classList.toggle('hidden', isAuthed);
  el.sessionPanel.classList.toggle('hidden', !isAuthed);
  el.sessionLabel.textContent = isAuthed ? `Signed in as ${state.auth.user.username}` : '';

  const loginSubmit = el.loginForm.querySelector('button[type="submit"]');
  if (el.loginUsername) {
    el.loginUsername.disabled = authBusy;
  }
  if (el.loginPassword) {
    el.loginPassword.disabled = authBusy;
  }
  if (loginSubmit instanceof HTMLButtonElement) {
    loginSubmit.disabled = authBusy;
    loginSubmit.textContent = authBusy ? 'Signing in…' : 'Sign in';
  }

  if (el.logoutBtn) {
    el.logoutBtn.disabled = !isAuthed || authBusy;
    el.logoutBtn.textContent = authBusy ? 'Signing out…' : 'Logout';
  }

  if (el.modeDemo) {
    el.modeDemo.disabled = !isAuthed || modeBusy || installBusy;
  }
  if (el.modeReal) {
    el.modeReal.disabled = !isAuthed || modeBusy || installBusy;
  }
  if (el.refreshDevices) {
    el.refreshDevices.disabled = !isAuthed || refreshBusy;
    el.refreshDevices.textContent = refreshBusy ? 'Rescanning…' : 'Rescan devices';
  }
  if (el.ipaInput) {
    el.ipaInput.disabled = !isAuthed || state.pending.upload;
  }
  if (el.ipaSelect) {
    el.ipaSelect.disabled = !isAuthed || installBusy;
  }
  if (el.deviceSelect) {
    el.deviceSelect.disabled = !isAuthed || installBusy;
  }
  if (el.runHelperDoctor) {
    el.runHelperDoctor.disabled = !isAuthed || helperBusy;
    el.runHelperDoctor.textContent = helperBusy ? 'Running…' : 'Run helper doctor';
  }
  if (el.rotateHelperToken) {
    el.rotateHelperToken.disabled = !isAuthed || helperBusy;
    el.rotateHelperToken.textContent = helperBusy ? 'Rotating…' : 'Rotate helper token';
  }

  if (el.downloadSupportSnapshot) {
    const snapshotBusy = state.pending.supportSnapshot;
    el.downloadSupportSnapshot.disabled = !isAuthed || snapshotBusy;
    el.downloadSupportSnapshot.textContent = snapshotBusy ? 'Preparing snapshot…' : 'Download support snapshot';
  }

  if (el.confirmRealExecution) {
    el.confirmRealExecution.disabled = !isAuthed || state.mode !== 'real' || installBusy;
  }

  if (el.runInstall) {
    el.runInstall.disabled = !isAuthed || realModeBlockedByMockSource || installBusy || !hasInstallInputs;
    el.runInstall.textContent = installBusy ? 'Queueing…' : 'Run Install Pipeline';
  }
};

const renderQuickStats = () => {
  const overview = state.overview;

  if (!overview) {
    el.quickStats.innerHTML = statPill('mode', state.mode.toUpperCase());
    return;
  }

  el.quickStats.innerHTML = [
    statPill('mode', state.mode.toUpperCase()),
    statPill('jobs running', overview.jobs?.running ?? 0),
    statPill('expiring', overview.counts?.expiring ?? 0),
    statPill('expired', overview.counts?.expired ?? 0),
    statPill('helper installs', overview.counts?.helperInstalls ?? 0)
  ].join('');
};

const renderOnboarding = () => {
  const settings = state.settings;

  const hints = [];
  if (!state.auth.authenticated) {
    hints.push('Sign in with the bootstrap admin account to unlock pipeline controls, logs, and helper diagnostics.');
  } else if (!state.ipas.length) {
    hints.push('Upload an IPA to initialize artifact inspection and target selection.');
  } else if (!state.jobs.length) {
    hints.push('Select an IPA and a device, then launch the install pipeline.');
  } else {
    hints.push('Pipeline and telemetry are live. Select a timeline job to inspect step-by-step command evidence.');
  }

  if (settings?.safety) {
    if (state.mode === 'real' && !settings.safety.realWorkerEnvEnabled) {
      hints.push('Real mode env gate is OFF. Set SIDELINK_ENABLE_REAL_WORKER=1 before any live command execution.');
    }

    if (state.mode === 'real' && state.devices.source !== 'real') {
      hints.push('Real mode currently sees fallback/mock devices. Rescan trusted hardware before running installs.');
    }

    hints.push(`Helper token: ${settings.safety.helperTokenPreview}`);
  }

  el.onboardingHint.textContent = hints.join(' ');

  const pills = [
    badge(`Mode · ${state.mode.toUpperCase()}`, 'info'),
    badge(
      `Scheduler · ${state.dashboard.scheduler.running ? 'RUNNING' : 'PAUSED'}`,
      state.dashboard.scheduler.running ? 'success' : 'warn'
    ),
    badge(`Auto-refresh · ${state.dashboard.scheduler.autoRefreshThresholdHours}h`, 'info'),
    badge(
      `Devices · ${state.devices.source}`,
      state.mode === 'real' && state.devices.source !== 'real' ? 'warn' : 'info'
    )
  ];

  if (settings?.safety) {
    pills.push(
      badge(
        `Real gate env · ${settings.safety.realWorkerEnvEnabled ? 'ON' : 'OFF'}`,
        settings.safety.realWorkerEnvEnabled ? 'success' : 'warn'
      )
    );
  }

  el.modePills.innerHTML = pills.join(' ');

  const safetyHints = [
    'Safety gates: enable SIDELINK_ENABLE_REAL_WORKER=1 and check “Confirm real command execution” before live signing/install actions.'
  ];

  if (state.mode === 'real' && state.devices.source !== 'real') {
    safetyHints.push('Real install actions stay blocked until device discovery source is REAL (no fallback source).');
  }

  el.pipelineSafetyHint.textContent = safetyHints.join(' ');
};

const renderModes = () => {
  el.modeDemo.classList.toggle('active', state.mode === 'demo');
  el.modeReal.classList.toggle('active', state.mode === 'real');
};

const renderKpis = () => {
  const counts = state.dashboard.counts || {};
  const jobs = state.overview?.jobs || {};

  const rows = [
    ['Installed apps', counts.installs ?? 0],
    ['Expiring soon', counts.expiring ?? 0],
    ['Expired', counts.expired ?? 0],
    ['Helper installs', counts.helperInstalls ?? 0],
    ['Jobs running', jobs.running ?? 0],
    ['Jobs failed', jobs.failed ?? 0]
  ];

  el.kpiGrid.innerHTML = rows
    .map(
      ([label, value]) => `
        <div class="kpi">
          <div class="label">${label}</div>
          <div class="value">${value}</div>
        </div>
      `
    )
    .join('');
};

const renderIpaList = () => {
  if (!state.ipas.length) {
    el.ipaList.innerHTML = empty();
    el.ipaSelect.innerHTML = '<option value="">Upload an IPA first</option>';
    return;
  }

  el.ipaSelect.innerHTML = state.ipas
    .map((ipa) => `<option value="${ipa.id}">${ipa.displayName} (${ipa.version})</option>`)
    .join('');

  el.ipaList.innerHTML = state.ipas
    .map((ipa) => {
      const capabilities = ipa.capabilities?.length ? ipa.capabilities.join(', ') : 'none detected';
      const sizeMb = Number.isFinite(ipa.sizeBytes) ? (ipa.sizeBytes / (1024 * 1024)).toFixed(1) : 'n/a';
      const warnings = ipa.warnings?.length
        ? `<p class="item-line">${badge(`${ipa.warnings.length} warning(s)`, 'warn')} <span class="meta-value">${ipa.warnings.join(' · ')}</span></p>`
        : `<p class="item-line">${badge('No signing warnings', 'success')}</p>`;

      return `
        <div class="item">
          <div class="item-head">
            <h3>${ipa.displayName}</h3>
            <div class="item-badges">${badge(`v${ipa.version}`, 'info')}</div>
          </div>
          <div class="meta-grid">
            <div class="meta-block">
              <span class="meta-label">Bundle ID</span>
              <code class="code-inline">${ipa.bundleId}</code>
            </div>
            <div class="meta-block">
              <span class="meta-label">Minimum iOS</span>
              <span class="meta-value">${ipa.minIOSVersion || 'n/a'}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">Package size</span>
              <span class="meta-value">${sizeMb} MB</span>
            </div>
          </div>
          <p class="item-line"><span class="meta-label">Capabilities</span> <span class="meta-value">${capabilities}</span></p>
          ${warnings}
        </div>
      `;
    })
    .join('');
};

const renderDevices = () => {
  const { devices, source, note } = state.devices;
  el.deviceSource.textContent = `Discovery source: ${source}${note ? ` · ${note}` : ''}`;

  if (!devices.length) {
    el.deviceList.innerHTML = empty();
    el.deviceSelect.innerHTML = '<option value="">No devices</option>';
    return;
  }

  el.deviceSelect.innerHTML = devices
    .map((device) => `<option value="${device.id}">${device.name} (${device.transport}/${device.connection})</option>`)
    .join('');

  el.deviceList.innerHTML = devices
    .map((device) => {
      const tone = device.connection === 'online' ? 'success' : device.connection === 'untrusted' ? 'warn' : 'error';
      const battery = Number.isFinite(device.batteryPercent) ? `${device.batteryPercent}%` : 'n/a';
      return `
        <div class="item">
          <div class="item-head">
            <h3>${device.name}</h3>
            <div class="item-badges">${badge(device.connection, tone)} ${badge(device.transport.toUpperCase(), 'info')}</div>
          </div>
          <div class="meta-grid">
            <div class="meta-block">
              <span class="meta-label">Model</span>
              <span class="meta-value">${device.model}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">iOS version</span>
              <span class="meta-value">${device.osVersion}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">Network</span>
              <span class="meta-value">${device.networkName || 'n/a'}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">Battery</span>
              <span class="meta-value">${battery}</span>
            </div>
          </div>
          <p class="item-line"><span class="meta-label">Last seen</span> <span class="meta-value">${formatDateTime(device.lastSeenAt)}</span></p>
        </div>
      `;
    })
    .join('');
};

const renderJobs = () => {
  if (!state.jobs.length) {
    el.jobList.innerHTML = empty();
    el.commandJobSelect.innerHTML = '<option value="">No jobs</option>';
    return;
  }

  el.commandJobSelect.innerHTML = state.jobs
    .map((job) => `<option value="${job.id}" ${job.id === state.selectedJobId ? 'selected' : ''}>${job.id} (${job.status})</option>`)
    .join('');

  el.jobList.innerHTML = state.jobs
    .map((job) => {
      const stepsList = Array.isArray(job.steps) ? job.steps : [];
      const steps = stepsList
        .map((step) => {
          const stepTone = step.state === 'success' ? 'success' : step.state === 'error' ? 'error' : step.state === 'skipped' ? 'warn' : 'info';
          return `<li class="step-line">${badge(step.state, stepTone)} <span><strong>${step.label}</strong>${step.detail ? ` — ${step.detail}` : ''}</span></li>`;
        })
        .join('');

      const completed = stepsList.filter((step) => ['success', 'error', 'skipped'].includes(step.state)).length;
      const progress = stepsList.length ? Math.round((completed / stepsList.length) * 100) : 0;
      const runtimeMs = durationBetween(job.startedAt, job.endedAt);

      return `
        <div class="item ${job.id === state.selectedJobId ? 'selected' : ''}" data-job-id="${job.id}">
          <div class="item-head">
            <h3>${job.id}</h3>
            <div class="item-badges">
              ${badge(job.mode.toUpperCase(), 'info')}
              ${badge(job.status, toneForStatus(job.status))}
              ${job.helperEnsured ? badge('helper ensured', 'success') : ''}
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-block">
              <span class="meta-label">Queued</span>
              <span class="meta-value">${formatDateTime(job.queuedAt)}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">Started</span>
              <span class="meta-value">${job.startedAt ? formatDateTime(job.startedAt) : 'pending'}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">Ended</span>
              <span class="meta-value">${job.endedAt ? formatDateTime(job.endedAt) : 'in progress'}</span>
            </div>
          </div>

          <p class="item-line"><span class="meta-label">Runtime</span> <span class="meta-value">${job.startedAt ? formatDurationMs(runtimeMs) : 'Waiting to start…'}</span></p>
          <p class="item-line"><span class="meta-label">Progress</span> <span class="meta-value">${completed}/${stepsList.length} steps</span></p>
          <div class="progress thin"><span style="width:${progress}%"></span></div>
          <ul class="step-list">${steps}</ul>
          ${job.error ? `<p class="item-line">${badge('error', 'error')} <span class="meta-value">${job.error}${job.action ? ` — ${job.action}` : ''}</span></p>` : ''}
          ${job.commandPreview?.length ? `<pre class="code-block">${job.commandPreview.join(' | ')}</pre>` : ''}
        </div>
      `;
    })
    .join('');
};

const renderCommands = () => {
  if (state.pending.commands) {
    el.commandList.innerHTML = empty('Loading command audit…');
    return;
  }

  if (!state.commandRuns.length) {
    el.commandList.innerHTML = empty();
    return;
  }

  const searchText = state.commandSearch.trim().toLowerCase();
  const filtered = state.commandRuns.filter((command) => {
    if (state.commandStatusFilter !== 'all' && command.status !== state.commandStatusFilter) {
      return false;
    }

    if (!searchText) {
      return true;
    }

    const haystack = [
      command.command,
      command.stepKey,
      ...(command.args || []),
      command.note || '',
      command.stderr || '',
      command.stdout || ''
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(searchText);
  });

  if (!filtered.length) {
    el.commandList.innerHTML = empty('No command runs match your filters.');
    return;
  }

  el.commandList.innerHTML = filtered
    .map((command) => {
      const runtimeMs = durationBetween(command.startedAt, command.endedAt);
      const args = Array.isArray(command.args) ? command.args : [];
      const shellLine = [command.command, ...args].filter(Boolean).join(' ');
      const stderr = command.stderr ? command.stderr.slice(0, 700) : '';
      const stdout = command.stdout ? command.stdout.slice(0, 520) : '';

      return `
        <div class="item">
          <div class="item-head">
            <h3>${humanizeToken(command.stepKey) || 'Command step'}</h3>
            <div class="item-badges">${badge(command.status, toneForStatus(command.status))}</div>
          </div>
          <p class="item-line"><span class="meta-label">Started</span> <span class="meta-value">${formatDateTime(command.startedAt)}</span></p>
          <pre class="code-block">${shellLine || 'n/a'}</pre>
          <div class="meta-grid">
            <div class="meta-block">
              <span class="meta-label">Exit code</span>
              <span class="meta-value">${command.exitCode ?? 'n/a'}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">Duration</span>
              <span class="meta-value">${formatDurationMs(runtimeMs)}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">CWD</span>
              <span class="meta-value">${command.cwd || 'n/a'}</span>
            </div>
          </div>
          ${command.note ? `<p class="item-line"><span class="meta-label">Note</span> <span class="meta-value">${command.note}</span></p>` : ''}
          ${stderr ? `<pre class="code-block">stderr\n${stderr}</pre>` : ''}
          ${stdout ? `<pre class="code-block">stdout\n${stdout}</pre>` : ''}
        </div>
      `;
    })
    .join('');
};

const renderDashboard = () => {
  const scheduler = state.dashboard.scheduler;
  const schedulerBusy = state.pending.scheduler;

  el.schedulerMeta.textContent = `Clock ${formatDateTime(scheduler.simulatedNow)} · Tick +${scheduler.simulatedHoursPerTick}h every ${Math.round(
    scheduler.tickIntervalMs / 1000
  )}s · Threshold ${scheduler.autoRefreshThresholdHours}h · ${scheduler.running ? 'running' : 'paused'}`;

  if (el.toggleScheduler) {
    el.toggleScheduler.textContent = schedulerBusy ? 'Saving…' : scheduler.running ? 'Pause' : 'Resume';
    el.toggleScheduler.disabled = !state.auth.authenticated || schedulerBusy;
  }

  if (el.advance6) {
    el.advance6.textContent = schedulerBusy ? 'Advancing…' : '+6h';
    el.advance6.disabled = !state.auth.authenticated || schedulerBusy;
  }

  if (el.advance24) {
    el.advance24.textContent = schedulerBusy ? 'Advancing…' : '+24h';
    el.advance24.disabled = !state.auth.authenticated || schedulerBusy;
  }

  if (!state.dashboard.installs.length) {
    el.installList.innerHTML = empty();
    return;
  }

  el.installList.innerHTML = state.dashboard.installs
    .map((install) => {
      const ratio = Math.max(0, Math.min(100, (install.hoursRemaining / 168) * 100));
      const auto = install.autoRefresh || {};
      const wifiWait = Number.isFinite(auto.wifiWaitRemainingRetries) ? auto.wifiWaitRemainingRetries : undefined;
      const decisionCode = auto.lastDecisionCode ? humanizeToken(auto.lastDecisionCode) : '';

      return `
        <div class="item">
          <div class="item-head">
            <h3>${install.label || install.ipa?.displayName || install.ipaId}</h3>
            <div class="item-badges">
              ${badge(install.kind.toUpperCase(), 'info')}
              ${badge(install.health, toneForHealth(install.health))}
              ${badge((install.device?.transport || 'unknown').toUpperCase(), 'info')}
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-block">
              <span class="meta-label">Device</span>
              <span class="meta-value">${install.device?.name || install.deviceId}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">Bundle ID</span>
              <span class="meta-value">${install.bundleId}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">Expiry</span>
              <span class="meta-value">${formatDateTime(install.expiresAt)}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">Remaining</span>
              <span class="meta-value">${install.hoursRemaining}h · ${install.refreshCount} refreshes</span>
            </div>
          </div>

          <p class="item-line"><span class="meta-label">Next auto attempt</span> <span class="meta-value">${formatDateTime(auto.nextAttemptAt)} · Retry ${auto.retryCount ?? 0} · Backoff ${auto.backoffMinutes ?? 0}m</span></p>
          <p class="item-line"><span class="meta-label">Plan</span> <span class="meta-value">${auto.nextAttemptReason || 'Waiting for next scheduled auto-refresh window.'}</span></p>
          ${decisionCode ? `<p class="item-line"><span class="meta-label">Decision</span> <span class="meta-value">${decisionCode}${wifiWait !== undefined ? ` · Wi‑Fi retries left ${wifiWait}` : ''}</span></p>` : ''}
          <p class="item-line"><span class="meta-label">Last attempt</span> <span class="meta-value">${formatDateTime(auto.lastAttemptAt)} · ${(auto.lastAttemptTransport || 'unknown').toUpperCase()}</span></p>
          ${auto.lastFailureReason ? `<p class="item-line">${badge('Last failure', 'warn')} <span class="meta-value">${auto.lastFailureReason}${auto.lastFailureAt ? ` · ${formatDateTime(auto.lastFailureAt)}` : ''}</span></p>` : ''}
          ${auto.lastSuccessAt ? `<p class="item-line"><span class="meta-label">Last success</span> <span class="meta-value">${formatDateTime(auto.lastSuccessAt)}</span></p>` : ''}
          <div class="progress"><span style="width:${ratio}%"></span></div>
          <div class="row-actions">
            <button data-install-refresh="${install.id}" ${state.pending.manualRefresh ? 'disabled' : ''}>${state.pending.manualRefresh ? 'Refreshing…' : 'Refresh now'}</button>
          </div>
        </div>
      `;
    })
    .join('');
};

const renderHelperSummary = () => {
  const settings = state.settings;
  const helper = settings?.helper;

  if (!settings) {
    el.helperSummary.innerHTML = empty();
    el.helperDoctor.innerHTML = empty();
    return;
  }

  const rows = [
    `
      <div class="item">
        <div class="item-head">
          <h3>Helper token</h3>
          <div class="item-badges">${badge('active', 'info')}</div>
        </div>
        <p class="item-line"><span class="meta-label">Preview</span> <code class="code-inline">${settings.safety.helperTokenPreview}</code></p>
      </div>
    `,
    `
      <div class="item">
        <div class="item-head">
          <h3>Artifact readiness</h3>
          <div class="item-badges">${badge(helper?.available ? 'ready' : 'missing', helper?.available ? 'success' : 'warn')}</div>
        </div>
        <p class="item-line"><span class="meta-value">${helper?.message || 'No helper status message.'}</span></p>
        <p class="item-line"><span class="meta-label">IPA path</span> <code class="code-inline">${helper?.ipaPath || 'n/a'}</code></p>
      </div>
    `,
    `
      <div class="item">
        <div class="item-head">
          <h3>Build tooling</h3>
          <div class="item-badges">${helper?.xcodebuildAvailable ? badge('xcodebuild', 'success') : badge('xcodebuild missing', 'warn')} ${helper?.xcodegenAvailable ? badge('xcodegen', 'success') : badge('xcodegen missing', 'warn')}</div>
        </div>
        <p class="item-line"><span class="meta-label">Build command</span></p>
        <pre class="code-block">${helper?.buildCommand || 'n/a'}</pre>
        <p class="item-line"><span class="meta-label">Export command</span></p>
        <pre class="code-block">${helper?.exportCommand || 'n/a'}</pre>
      </div>
    `
  ];

  el.helperSummary.innerHTML = rows.join('');

  if (!state.helperDoctor) {
    el.helperDoctor.innerHTML = empty('Run helper doctor for environment readiness checks.');
    return;
  }

  const report = state.helperDoctor;
  const checks = Object.entries(report.checks || {})
    .map(([key, value]) => {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
      return `<li class="step-line">${badge(value.ok ? 'ok' : 'missing', value.ok ? 'success' : 'warn')} <span><strong>${label}</strong> — ${value.detail}</span></li>`;
    })
    .join('');

  const actions = report.recommendedActions?.length
    ? report.recommendedActions.map((item) => `<li>${item}</li>`).join('')
    : '<li>No action needed. Helper path is ready.</li>';

  el.helperDoctor.innerHTML = `
    <div class="item">
      <div class="item-head">
        <h3>Helper doctor · ${formatDateTime(report.checkedAt)}</h3>
        <div class="item-badges">
          ${badge(report.readyForBuild ? 'build ready' : 'build blocked', report.readyForBuild ? 'success' : 'warn')}
          ${badge(report.readyForExport ? 'export ready' : 'export blocked', report.readyForExport ? 'success' : 'warn')}
          ${badge(report.artifactReady ? 'ipa ready' : 'ipa missing', report.artifactReady ? 'success' : 'warn')}
        </div>
      </div>
      <ul class="step-list">${checks}</ul>
      <p class="item-line"><span class="meta-label">Recommended actions</span></p>
      <ul class="helper-actions">${actions}</ul>
    </div>
  `;
};

const renderLogs = () => {
  const summary = state.logsMeta
    ? `
      <div class="item">
        <div class="item-head">
          <h3>Log match window</h3>
          <div class="item-badges">${badge('logs', 'info')}</div>
        </div>
        <p class="meta-value">Showing ${state.logsMeta.returned} of ${state.logsMeta.matched} matched logs · ${state.logsMeta.totalStored} stored total${
          state.logsMeta.hasMore ? ' · refine filters for older entries' : ''
        }</p>
      </div>
    `
    : '';

  if (!state.logs.length) {
    const filtered = state.logLevelFilter !== 'all' || Boolean(state.logSearch.trim());
    const message = filtered ? 'No logs match the current filters.' : 'No records yet.';
    el.logList.innerHTML = `${summary}${empty(message)}`;
    return;
  }

  el.logList.innerHTML = `${summary}${state.logs
    .map((log) => {
      const tone = log.level === 'error' ? 'error' : log.level === 'warn' ? 'warn' : 'info';
      const context = log.context ? JSON.stringify(log.context).slice(0, 620) : '';
      return `
        <div class="item">
          <div class="item-head">
            <h3>${log.code}</h3>
            <div class="item-badges">${badge(log.level, tone)}</div>
          </div>
          <p class="item-line"><span class="meta-label">Timestamp</span> <span class="meta-value">${formatDateTime(log.at)}</span></p>
          <p class="meta-value">${log.message}</p>
          ${log.action ? `<p class="item-line"><span class="meta-label">Action</span> <span class="meta-value">${log.action}</span></p>` : ''}
          ${context ? `<pre class="code-block">${context}</pre>` : ''}
        </div>
      `;
    })
    .join('')}`;
};

const renderAll = () => {
  if (el.commandStatusFilter.value !== state.commandStatusFilter) {
    el.commandStatusFilter.value = state.commandStatusFilter;
  }
  if (el.commandSearch.value !== state.commandSearch) {
    el.commandSearch.value = state.commandSearch;
  }

  if (el.logLevelFilter.value !== state.logLevelFilter) {
    el.logLevelFilter.value = state.logLevelFilter;
  }

  if (el.logSearch.value !== state.logSearch) {
    el.logSearch.value = state.logSearch;
  }

  if (el.refreshAll) {
    el.refreshAll.disabled = state.pending.refresh;
    el.refreshAll.textContent = state.pending.refresh ? 'Refreshing…' : 'Refresh all data';
  }

  const uploadSubmit = el.uploadForm.querySelector('button[type="submit"]');
  if (uploadSubmit instanceof HTMLButtonElement) {
    uploadSubmit.disabled = state.pending.upload || !state.auth.authenticated;
    uploadSubmit.textContent = state.pending.upload ? 'Uploading…' : 'Upload + Inspect';
  }

  if (el.loadCommands) {
    el.loadCommands.disabled = state.pending.commands || !state.selectedJobId;
    el.loadCommands.textContent = state.pending.commands ? 'Loading…' : 'Load audit';
  }

  if (el.commandJobSelect) {
    el.commandJobSelect.disabled = state.pending.commands || !state.jobs.length;
  }

  const logControlsDisabled = !state.auth.authenticated || state.pending.logs || state.pending.refresh;
  if (el.logLevelFilter) {
    el.logLevelFilter.disabled = logControlsDisabled;
  }

  if (el.logSearch) {
    el.logSearch.disabled = logControlsDisabled;
  }

  if (el.downloadSupportSnapshot) {
    el.downloadSupportSnapshot.disabled = state.pending.supportSnapshot || !state.auth.authenticated;
    el.downloadSupportSnapshot.textContent = state.pending.supportSnapshot ? 'Preparing snapshot…' : 'Download support snapshot';
  }

  renderAuth();
  renderModes();
  renderQuickStats();
  renderOnboarding();
  renderKpis();
  renderIpaList();
  renderDevices();
  renderJobs();
  renderCommands();
  renderDashboard();
  renderHelperSummary();
  renderLogs();
};

const loadSession = async () => {
  const result = await api('/api/auth/session');
  state.auth.authenticated = result.authenticated;
  state.auth.user = result.user || null;
};

const loadMode = async () => {
  const result = await api('/api/mode');
  state.mode = result.mode;
};

const loadIpas = async () => {
  const result = await api('/api/ipa');
  state.ipas = result.items;
};

const loadDevices = async (refresh = false) => {
  const result = await api(`/api/devices?mode=${state.mode}${refresh ? '&refresh=1' : ''}`);
  state.devices = result;
};

const loadJobs = async () => {
  const result = await api('/api/jobs');
  state.jobs = result.items;

  if (state.selectedJobId && !state.jobs.some((job) => job.id === state.selectedJobId)) {
    state.selectedJobId = '';
  }

  if (!state.selectedJobId && state.jobs.length) {
    state.selectedJobId = state.jobs[0].id;
  }
};

const loadDashboard = async () => {
  const result = await api('/api/dashboard');
  state.dashboard = result;
};

const loadOverview = async () => {
  const result = await api('/api/overview');
  state.overview = result;
};

const loadSettings = async () => {
  if (!state.auth.authenticated) {
    state.settings = null;
    return;
  }

  state.settings = await api('/api/settings');
};

const loadHelperDoctor = async () => {
  if (!state.auth.authenticated) {
    state.helperDoctor = null;
    return;
  }

  state.helperDoctor = await api('/api/helper/doctor');
};

const buildLogQueryParams = (baseLimit = 140) => {
  const params = new URLSearchParams();
  params.set('limit', String(baseLimit));

  if (state.logLevelFilter && state.logLevelFilter !== 'all') {
    params.set('level', state.logLevelFilter);
  }

  const search = state.logSearch.trim();
  if (search) {
    params.set('search', search);
  }

  return params;
};

const loadLogs = async () => {
  const params = buildLogQueryParams(140);
  const result = await api(`/api/logs?${params.toString()}`);
  state.logs = result.items;
  state.logsMeta = result.meta || null;
};

const loadCommandRuns = async () => {
  if (!state.selectedJobId) {
    state.commandRuns = [];
    return;
  }

  try {
    const result = await api(`/api/jobs/${state.selectedJobId}/commands`);
    state.commandRuns = result.items;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Job not found')) {
      state.selectedJobId = '';
      state.commandRuns = [];
      return;
    }

    throw error;
  }
};

const refreshAllData = async ({ forceDevices = false, includeCommands = true } = {}) => {
  if (!state.auth.authenticated) {
    renderAll();
    return;
  }

  await Promise.all([
    loadMode(),
    loadIpas(),
    loadDevices(forceDevices),
    loadJobs(),
    loadDashboard(),
    loadOverview(),
    loadSettings(),
    loadHelperDoctor(),
    loadLogs()
  ]);

  if (includeCommands) {
    await loadCommandRuns();
  }

  renderAll();
};

const initEvents = () => {
  el.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    el.authError.textContent = '';

    try {
      await withPending('auth', async () => {
        const username = el.loginUsername.value.trim();
        const password = el.loginPassword.value;
        await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });

        el.loginPassword.value = '';
        await loadSession();
        await refreshAllData({ forceDevices: true });
        showToast(`Welcome back, ${state.auth.user?.username || username}.`, 'success');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.logoutBtn.addEventListener('click', async () => {
    try {
      await withPending('auth', async () => {
        await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
        await loadSession();
        clearProtectedState();
        renderAll();
        showToast('Signed out.', 'info');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  const handleModeChange = async (mode) => {
    try {
      await withPending('mode', async () => {
        requireAuth();
        await api('/api/mode', { method: 'POST', body: JSON.stringify({ mode }) });
        state.mode = mode;
        await refreshAllData({ forceDevices: true });
        showToast(`Mode switched to ${mode.toUpperCase()}.`, mode === 'real' ? 'warn' : 'success');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  };

  el.modeDemo.addEventListener('click', () => handleModeChange('demo'));
  el.modeReal.addEventListener('click', () => handleModeChange('real'));

  el.uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    el.uploadError.textContent = '';

    try {
      await withPending('upload', async () => {
        requireAuth();
        if (!el.ipaInput.files?.length) {
          el.uploadError.textContent = 'Select an IPA file first.';
          return;
        }

        const form = new FormData();
        form.append('ipa', el.ipaInput.files[0]);

        await api('/api/ipa/upload', { method: 'POST', body: form });
        el.uploadForm.reset();
        await refreshAllData();
        showToast('IPA uploaded and inspected.', 'success');
      });
    } catch (error) {
      el.uploadError.textContent = error.message;
    }
  });

  el.runInstall.addEventListener('click', async () => {
    try {
      await withPending('install', async () => {
        requireAuth();
        const ipaId = el.ipaSelect.value;
        const deviceId = el.deviceSelect.value;

        if (!ipaId || !deviceId) {
          const message = 'Pick IPA and device first.';
          el.authError.textContent = message;
          showToast(message, 'warn');
          return;
        }

        await api('/api/install', {
          method: 'POST',
          body: JSON.stringify({
            ipaId,
            deviceId,
            mode: state.mode,
            confirmRealExecution: state.mode === 'real' ? el.confirmRealExecution.checked : false
          })
        });

        await refreshAllData({ includeCommands: false });
        if (state.jobs.length) {
          state.selectedJobId = state.jobs[0].id;
          await loadCommandRuns();
        }
        renderAll();
        showToast('Install pipeline queued.', 'success');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.refreshDevices.addEventListener('click', async () => {
    try {
      await withPending('refresh', async () => {
        requireAuth();
        await refreshAllData({ forceDevices: true });
        showToast('Device inventory refreshed.', 'info');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.refreshAll.addEventListener('click', async () => {
    try {
      await withPending('refresh', async () => {
        await refreshAllData({ forceDevices: true });
        if (state.auth.authenticated) {
          showToast('Control center refreshed.', 'info');
        }
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.jobList.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const row = target.closest('[data-job-id]');
    if (!(row instanceof HTMLElement)) return;

    const jobId = row.getAttribute('data-job-id');
    if (!jobId) return;

    try {
      await withPending('commands', async () => {
        state.selectedJobId = jobId;
        await loadCommandRuns();
        renderCommands();
        el.commandJobSelect.value = jobId;
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.loadCommands.addEventListener('click', async () => {
    try {
      await withPending('commands', async () => {
        const selected = el.commandJobSelect.value;
        state.selectedJobId = selected;
        await loadCommandRuns();
        renderCommands();
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.commandStatusFilter.addEventListener('change', () => {
    state.commandStatusFilter = el.commandStatusFilter.value;
    renderCommands();
  });

  el.commandSearch.addEventListener('input', () => {
    state.commandSearch = el.commandSearch.value || '';
    renderCommands();
  });

  const refreshLogsWithFilters = async () => {
    if (!state.auth.authenticated) {
      return;
    }

    await withPending('logs', async () => {
      await loadLogs();
      renderLogs();
    });
  };

  el.logLevelFilter.addEventListener('change', async () => {
    state.logLevelFilter = el.logLevelFilter.value || 'all';

    try {
      await refreshLogsWithFilters();
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  let logSearchTimer;
  el.logSearch.addEventListener('input', () => {
    state.logSearch = el.logSearch.value || '';

    if (logSearchTimer) {
      clearTimeout(logSearchTimer);
    }

    logSearchTimer = setTimeout(async () => {
      try {
        await refreshLogsWithFilters();
      } catch (error) {
        el.authError.textContent = error.message;
      }
    }, 220);
  });

  el.installList.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const installId = target.getAttribute('data-install-refresh');
    if (!installId) {
      return;
    }

    try {
      await withPending('manualRefresh', async () => {
        requireAuth();
        await api(`/api/apps/${installId}/refresh`, { method: 'POST', body: JSON.stringify({}) });
        await refreshAllData();
        showToast('Manual refresh completed.', 'success');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.advance6.addEventListener('click', async () => {
    try {
      await withPending('scheduler', async () => {
        requireAuth();
        await api('/api/scheduler/advance-hours', { method: 'POST', body: JSON.stringify({ hours: 6 }) });
        await refreshAllData();
        showToast('Scheduler advanced by 6h.', 'info');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.advance24.addEventListener('click', async () => {
    try {
      await withPending('scheduler', async () => {
        requireAuth();
        await api('/api/scheduler/advance-hours', { method: 'POST', body: JSON.stringify({ hours: 24 }) });
        await refreshAllData();
        showToast('Scheduler advanced by 24h.', 'info');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.toggleScheduler.addEventListener('click', async () => {
    try {
      await withPending('scheduler', async () => {
        requireAuth();
        const running = !state.dashboard.scheduler.running;
        await api('/api/scheduler/running', { method: 'POST', body: JSON.stringify({ running }) });
        await refreshAllData();
        showToast(`Scheduler ${running ? 'resumed' : 'paused'}.`, running ? 'success' : 'warn');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.runHelperDoctor.addEventListener('click', async () => {
    try {
      await withPending('helper', async () => {
        requireAuth();
        await loadHelperDoctor();
        renderHelperSummary();
        showToast('Helper doctor report refreshed.', 'info');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.rotateHelperToken.addEventListener('click', async () => {
    try {
      await withPending('helper', async () => {
        requireAuth();
        const result = await api('/api/settings/helper-token/rotate', { method: 'POST', body: JSON.stringify({}) });
        await refreshAllData({ includeCommands: false });
        showToast(`Helper token rotated. New token: ${result.token}`, 'warn');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });

  el.downloadSupportSnapshot.addEventListener('click', async () => {
    try {
      await withPending('supportSnapshot', async () => {
        requireAuth();

        const params = new URLSearchParams({
          includeLogs: '1',
          logLimit: '400',
          includeCommands: '1'
        });

        if (state.logLevelFilter && state.logLevelFilter !== 'all') {
          params.set('logLevel', state.logLevelFilter);
        }

        if (state.logSearch.trim()) {
          params.set('logSearch', state.logSearch.trim());
        }

        const payload = await api(`/api/support/snapshot?${params.toString()}`);
        downloadJsonFile(payload, buildSnapshotFilename(payload.generatedAt));
        showToast('Support snapshot downloaded.', 'success');
      });
    } catch (error) {
      el.authError.textContent = error.message;
    }
  });
};

const boot = async () => {
  await loadSession();
  await loadMode();
  initEvents();

  if (state.auth.authenticated) {
    await refreshAllData({ forceDevices: true });
  } else {
    renderAll();
  }

  setInterval(async () => {
    if (!state.auth.authenticated) {
      return;
    }

    if (Object.values(state.pending).some(Boolean)) {
      return;
    }

    try {
      await Promise.all([loadJobs(), loadDashboard(), loadOverview(), loadLogs()]);
      if (!state.selectedJobId && state.jobs.length) {
        state.selectedJobId = state.jobs[0].id;
      }
      await loadCommandRuns();
      renderAll();
    } catch {
      // no-op polling failure; detailed errors are surfaced via explicit actions
    }
  }, 3200);
};

boot().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to boot UI', error);
});
