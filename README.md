# Sidelink

Compliant personal iOS sideload manager with:

- premium web/desktop control center
- helper-first install orchestration
- guarded real execution path (sign/install)
- SQLite persistence + hardened auth
- autonomous 48h auto-refresh planner (Wi‑Fi preferred)

## Compliance stance

Sidelink intentionally stays compliant:

- ✅ no jailbreak workflows
- ✅ no enterprise certificate abuse logic
- ✅ no piracy logic

---

## Quick start

```bash
cd /Users/gabriel/.openclaw/workspace/projects/altstore-demo
npm install
npm run db:migrate
```

Bootstrap admin credentials (recommended):

```bash
SIDELINK_ADMIN_USERNAME=admin SIDELINK_ADMIN_PASSWORD='StrongPass123!' npm run db:bootstrap -- --require-env
```

Then run web app:

```bash
npm run web
```

Open:

- <http://127.0.0.1:4010>

---

## Run commands

### Web/API

```bash
npm run web
npm run dev
npm run clean
npm run lint
npm test
npm run build
```

> `npm test` is configured for deterministic single-worker execution because the suite includes integration-style API/pipeline scenarios that can flake under aggressive parallel workers.
>
> `npm run build` performs a clean `dist/` rebuild each run to avoid stale packaged artifacts.
>
> Host-Node commands that load SQLite (`web`, `dev`, `test`, `test:watch`, `db:migrate`, `db:bootstrap`) auto-run `npm run node:preflight` first, so `better-sqlite3` ABI drift is healed before startup.

### Desktop

```bash
npm run icon:generate
npm run desktop:easy
npm run desktop:preflight
npm run desktop:dev
npm run desktop:deps
npm run desktop:package
```

`npm run icon:generate` rebuilds branded icon assets in `build/icons/`.
`npm run desktop:easy` is the one-command local flow: migrate DB, reset/bootstrap admin credentials, clear stale auth lockouts/sessions, and launch desktop.
`npm run desktop:preflight` verifies Electron can load native modules, auto-runs `desktop:deps`, and if needed forces a clean `better-sqlite3` rebuild + recheck.
`npm run desktop:dev` runs build + preflight before launching Electron, so ABI mismatches are auto-healed after `npm install`/`npm rebuild`.
`npm run desktop:deps` remains available for manual one-off native dependency rebuilds.
`npm run desktop:package` uses `build/icons/icon.icns` for the packaged macOS app icon and now runs the same native preflight before packaging.

Default `desktop:easy` credentials (override via env vars if needed):
- username: `admin`
- password: `Admin1234!`

When `SIDELINK_ADMIN_PASSWORD` is supplied, `desktop:easy` masks it in console output to avoid leaking custom credentials into shared logs.

`desktop:easy` also aligns desktop dev DB path to `tmp/desktop/sidelink.sqlite` (matching bootstrap flow) and supports setup-only mode:

```bash
npm run desktop:easy -- --setup-only
```

### DB / admin

```bash
npm run db:migrate
npm run db:bootstrap
npm run db:bootstrap -- --require-env
```

`db:migrate` and `db:bootstrap` share the same host-Node native preflight used by web/dev/test flows, so `better-sqlite3` is rebuilt for Node automatically when needed.

### iOS helper build/export

```bash
npm run helper:build
npm run helper:export
```

---

## Authentication model

- Login: `POST /api/auth/login`
- Logout: `POST /api/auth/logout`
- Session introspection: `GET /api/auth/session`
- Session transport: HTTP-only cookie (`sidelink_session` default)
- Password hashing: salted `scrypt`
- Hardening: failed-login lockout (persisted across restart) + active session pruning
- HTTP response hardening: CSP + anti-framing/security headers and `Cache-Control: no-store` on `/api/*`

Operational routes (read + write) require auth except `/api/health`, `/api/mode`, and helper-token-authorized helper endpoints.

---

## Real mode safety gates (guarded execution)

Real command execution requires ALL safeguards:

1. Environment gate:

```bash
SIDELINK_ENABLE_REAL_WORKER=1
```

2. API/UI confirmation gate:
- request body: `confirmRealExecution: true`
- UI checkbox: “Confirm real command execution”

3. Real device provenance gate:
- discovery source must be `real` (mock fallback is blocked in real mode)
- target device entry must be sourced from real adapter inventory

Without all gates, real mode stays in preview/preflight (or is blocked before execution) and persists command audits/actionable errors.

### Signing identity

```bash
SIDELINK_REAL_SIGNING_IDENTITY='Apple Development: Your Name (TEAMID)'
```

Only Apple Development identities are accepted. Enterprise/distribution patterns are blocked.
If your preferred identity has no usable profile, Sidelink now auto-tries other local Apple Development identities and picks one that has a compatible profile.

Optional explicit provisioning profile override (otherwise Sidelink auto-discovers a local matching profile). If the pinned profile is incompatible, Sidelink now auto-falls back to discovered compatible profiles/identities:

```bash
SIDELINK_REAL_PROVISION_PROFILE='/Users/you/Library/MobileDevice/Provisioning Profiles/<profile>.mobileprovision'
```

Optional bundle-id override for real signing (use when your available profile does not match the source app bundle ID):

```bash
SIDELINK_REAL_BUNDLE_ID_OVERRIDE='com.yourteam.sidelink.youtube'
```

When no direct profile match exists, Sidelink now attempts automatic fallback remap using eligible team profiles.

---

## Helper app integration (SwiftUI)

In-repo helper source:

- `ios-helper/SidelinkHelper/`

Helper capabilities:

- installed app status + next refresh window
- connectivity + refresh health
- helper-token-based refresh trigger (`/api/helper/refresh`)
  - authenticated web UI/admin calls can omit `installId` to target the most urgent **primary** app
  - helper-token calls must include `installId` or `deviceId` (scope hardening)
  - if both `installId` and `deviceId` are provided, they must resolve to the same install target (conflicts are rejected)
  - helper app can explicitly refresh helper lifecycle by passing `installId`

### Helper auto-install behavior

Install pipeline includes an `ensure-helper-app` step before primary app installation.

- **Demo mode:** helper ensure is simulated + lifecycle record is registered
- **Real mode with helper IPA available:** helper install is executed first
- **Real mode without helper IPA:** graceful fallback (warning + actionable unblock steps), primary app install still proceeds
- **Real mode helper install runtime failure:** downgraded to warning + command audit, primary app install still proceeds
- **Existing healthy helper lifecycle:** helper reinstall is skipped when the target device already has a tracked helper with >24h remaining
- **Queue safety:** same-device installs are serialized to prevent signing/install collisions, and duplicate in-flight requests are deduplicated
- **Crash/restart safety:** interrupted queued/running jobs are auto-recovered as actionable errors on boot (no stale “running forever” cards)

Default helper IPA path used by backend:

```text
tmp/helper/SidelinkHelper.ipa
```

Helper doctor diagnostics (UI button + API) surface build/export readiness and actionable unblock steps (including helper build/export scripts + artifact directory checks):

```bash
curl -b "sidelink_session=<cookie>" http://127.0.0.1:4010/api/helper/doctor
```

Helper status endpoint now includes refresh diagnostics (`helperInstalls`, `primaryInstalls`) and a `suggestedRefreshTarget` using the same selection policy as `/api/helper/refresh`.

---

## Auto-refresh engine behavior

- Lifecycle expiry model: 7 days
- Auto-refresh threshold: **48h before expiry**
- Policy: **Wi‑Fi preferred**
- If Wi‑Fi unavailable:
  - defer/retry with backoff first
  - fallback to available transport when retry threshold is exceeded
- Retry state is persisted per install:
  - next attempt + next-attempt reason
  - retry count/backoff
  - decision code (for UI/diagnostics clarity)
  - remaining Wi‑Fi wait retries (when applicable)
  - last failure reason
  - last success timestamp
- Real mode refreshes (auto/manual/helper) require real discovery source; mock-fallback refresh attempts are blocked and retried with actionable reasons

Scheduler controls are available via API/UI (pause/resume/manual time advance for testing).

---

## Environment variables

### Primary namespace (recommended)

- `SIDELINK_PORT`
- `SIDELINK_HOST`
- `SIDELINK_MODE` (`demo` | `real`)
- `SIDELINK_DB_PATH`
- `SIDELINK_UPLOAD_DIR`
- `SIDELINK_CLIENT_DIR`
- `SIDELINK_ADMIN_USERNAME`
- `SIDELINK_ADMIN_PASSWORD`
- `SIDELINK_ADMIN_RESET_ON_BOOT`
- `SIDELINK_AUTH_COOKIE_NAME`
- `SIDELINK_SESSION_TTL_HOURS`
- `SIDELINK_ENABLE_REAL_WORKER`
- `SIDELINK_REAL_SIGNING_IDENTITY`
- `SIDELINK_REAL_PROVISION_PROFILE`
- `SIDELINK_REAL_BUNDLE_ID_OVERRIDE`
- `SIDELINK_HELPER_API_TOKEN`
- `SIDELINK_HELPER_PROJECT_DIR`
- `SIDELINK_HELPER_IPA_PATH`
- `SIDELINK_AUTO_REFRESH_THRESHOLD_HOURS`
- `SIDELINK_AUTO_REFRESH_INITIAL_BACKOFF_MINUTES`
- `SIDELINK_AUTO_REFRESH_MAX_BACKOFF_MINUTES`
- `SIDELINK_AUTO_REFRESH_WIFI_WAIT_RETRIES`

### Backward compatibility

Legacy `ALTSTORE_*` variables are still accepted as fallbacks to avoid breaking existing local setups.

---

## API highlights

- `GET /api/health`
- `GET /api/overview`
- `GET /api/settings`
- `POST /api/settings/helper-token/rotate`
- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/mode`
- `POST /api/mode`
- `POST /api/ipa/upload`
- `GET /api/ipa`
- `GET /api/devices`
- `POST /api/install`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/commands`
- `GET /api/dashboard`
- `POST /api/apps/:id/refresh`
- `GET /api/helper/status`
- `GET /api/helper/doctor`
- `POST /api/helper/refresh`
- `GET /api/scheduler`
- `POST /api/scheduler/running`
- `POST /api/scheduler/advance-hours`
- `GET /api/logs`
- `GET /api/support/snapshot` (auth required; optional `includeLogs`, `logLimit`, `download=1`, `logLevel`, `logCode`, `logSearch`, `logBefore`, `logAfter`, `jobLimit`, `jobStatus`, `jobMode`, `jobDeviceId`, `jobIpaId`, `jobBefore`, `jobAfter`, `includeCommands`, `commandLimit`, `commandStatus`, `commandStepKey`, `commandSearch`, `commandBefore`, `commandAfter`)

### Job query filters

`GET /api/jobs` supports optional operational filters:

- `limit` (1-600, optional; default returns all matched jobs)
- `status` (comma-separated: `queued,running,success,error`)
- `mode` (`demo` or `real`)
- `deviceId` / `ipaId` (exact match)
- `before` / `after` (ISO timestamp window against `queuedAt`)

The response includes `meta` (`returned`, `matched`, `totalStored`, `hasMore`, active `filters`) for queue triage.

### Command diagnostics filters

`GET /api/jobs/:id/commands` supports bounded command-audit filters:

- `limit` (1-600)
- `status` (comma-separated: `success,error,skipped`)
- `stepKey` (exact step key)
- `search` (case-insensitive search over command/args/note/stdout/stderr/cwd)
- `before` / `after` (ISO timestamp window against `startedAt`)
- `includeOutput` (`0` / `false` to omit `stdout` + `stderr` payloads)

The response includes `meta` plus active filter echoing for support/debug handoff.

### Log query filters

`GET /api/logs` supports bounded diagnostics filters:

- `limit` (1-600)
- `level` (comma-separated: `info,warn,error,debug`)
- `code` (case-insensitive code match)
- `search` (case-insensitive text over code/message/action/context)
- `before` / `after` (ISO timestamp window)

The response includes `meta` (`returned`, `matched`, `hasMore`, active `filters`) for operational triage.

Support snapshots use the same filter model with prefixed params (`logLevel`, `logCode`, `logSearch`, `logBefore`, `logAfter`).

Diagnostics safety: `/api/logs`, `/api/jobs/:id/commands`, and support snapshot exports automatically redact common secret patterns (passwords, tokens, bearer/cookie-style credentials, and sensitive context keys) so support handoffs avoid leaking live credentials.

Operational shortcut: the **Operational Logs** card includes inline level/search controls plus a **Download support snapshot** button that exports a JSON snapshot with bounded logs + command summaries for support handoff.

---

## Reality matrix (what is real vs constrained)

### Fully real

- IPA parsing + entitlement extraction
- SQLite persistence lifecycle
- local auth/session management with hardening
- guarded real worker command path + command audit persistence
- helper token flow and helper status/refresh APIs
- helper-first orchestration behavior in install pipeline
- persisted auto-refresh planner state (threshold/backoff/failure reasons)

### Real but environment-dependent

- real USB/Wi‑Fi discovery via `libimobiledevice`
- real signing/install execution (requires local toolchain + valid Apple Development signing)
- helper IPA build/export (requires full Xcode + signing/provisioning)

### Simulated by design

- demo-mode install timing/outcomes
- scheduler time acceleration controls (`advance-hours`) for testing lifecycle behavior quickly

---

## Toolchain prerequisites for real execution

```bash
xcode-select --install
brew install libimobiledevice
```

Optional (helper project generation):

```bash
brew install xcodegen
```

If `xcodebuild` is unavailable in this environment, helper source + scripts are still fully included; build/export on a full Xcode macOS machine.
