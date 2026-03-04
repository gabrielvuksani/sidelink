# ARCHITECTURE.md

## Goal

Sidelink is a compliant personal sideload control system with three priorities:

1. premium operational UX
2. helper-first install orchestration
3. autonomous 48h pre-expiry refresh planning (Wi‑Fi preferred)

All while preserving explicit safety constraints (no jailbreak / no enterprise abuse / no piracy).

---

## High-level components

- **Express API server** (`src/server/app.ts`)
  - auth, settings, IPA import, device discovery, install pipeline, scheduler controls, helper endpoints, filtered logs API, filtered jobs/command diagnostics API, support snapshot export
- **Context bootstrap** (`src/server/context.ts`)
  - config resolution, env compatibility, service wiring
- **SQLite-backed store** (`src/server/state/store.ts`)
  - durable state for jobs, installs, scheduler, command audits, auth/session, helper token
- **Auth service** (`src/server/services/auth-service.ts`)
  - admin bootstrap, password hashing, session creation/revocation, lockout policy, session pruning
- **IPA service** (`src/server/services/ipa-service.ts`)
  - IPA metadata and entitlement extraction
- **Device service + adapters** (`src/server/services/device-service.ts`, `src/server/adapters/*device*`)
  - real adapter (`idevice_id`/`ideviceinfo`) with transport metadata (USB/Wi‑Fi) + mock fallback
- **Pipeline service** (`src/server/services/pipeline-service.ts`)
  - step-based install orchestration with helper ensure step and guarded real execution gates
- **Scheduler service** (`src/server/services/scheduler-service.ts`)
  - lifecycle model, 48h planner, Wi‑Fi-preferred retry/backoff logic, persisted auto-refresh telemetry
- **Helper service** (`src/server/services/helper-service.ts`)
  - helper artifact status, helper token lifecycle, helper build/export guidance, helper doctor readiness diagnostics
- **Desktop wrapper** (`src/desktop/main.ts`)
  - local backend launch + BrowserWindow shell
- **Frontend control center** (`src/client/*`)
  - premium dashboard with lifecycle, pipeline timeline, command explorer, helper state, settings safety panel
- **iOS helper source project** (`ios-helper/SidelinkHelper/*`)
  - SwiftUI app for status visibility + helper-triggered refresh

---

## Install pipeline sequence

`PipelineService.enqueueInstall()` persists a job and runs steps:

1. `validate-inputs`
2. `ensure-helper-app` (helper-first strategy)
3. `prepare-signing`
4. `install-app`
5. `register-refresh`

### Helper step behavior

- Demo mode: helper ensure simulated + helper lifecycle record registered
- Real mode, helper IPA available + gates open: helper install command executes first
- Existing healthy helper lifecycle (>24h remaining): helper reinstall is skipped and pipeline continues
- Real mode, helper IPA missing: warning + actionable fallback (pipeline continues)
- Real mode, helper install runtime failure: soft-fail warning + command audit; pipeline continues with primary install
- Same-device jobs are serialized through a per-device queue to prevent signing/install collisions
- Duplicate in-flight install requests (same mode + device + IPA) are deduplicated and return the existing job
- Queued/running jobs interrupted by restart are recovered to actionable `error` state on boot (prevents stale dead-job UI)

### Real execution gates

For real command execution (`codesign`, `ideviceinstaller`) all are required:

- `SIDELINK_ENABLE_REAL_WORKER=1` (legacy `ALTSTORE_ENABLE_REAL_WORKER` also recognized)
- API/UI confirmation (`confirmRealExecution: true`)
- real device provenance (discovery source must be `real`, mock fallback is blocked)

If any gate is closed, command audits are persisted as `skipped` (or validation blocks early) with actionable reasons.

---

## Scheduler/refresh model

Each install record includes persisted auto-refresh state:

- `nextAttemptAt`
- `nextAttemptReason`
- `retryCount`
- `backoffMinutes`
- `lastDecisionCode`
- `wifiWaitRemainingRetries` (when Wi‑Fi deferrals are active)
- `lastFailureReason`
- `lastSuccessAt`
- `lastAttemptTransport`

Planner rules:

- threshold window opens at 48h before expiry
- Wi‑Fi preferred for auto attempts
- if Wi‑Fi missing, defer with backoff first
- fallback to available transport after configured Wi‑Fi wait retries
- all failures schedule explicit next attempt and actionable logs
- real-mode refresh paths require real discovery source; mock-fallback refresh attempts are blocked with retryable guidance

Manual refresh and helper-triggered refresh paths reuse the same lifecycle update mechanics.
Helper-triggered refresh defaults to the most urgent primary install target unless an explicit `installId` is provided.
For helper-token-authenticated requests, `/api/helper/refresh` requires explicit scope (`installId` or `deviceId`) to avoid broad unscoped refreshes.
If both selectors are provided, they must resolve to the same install target (scope conflicts are rejected).
`GET /api/helper/status` exposes matching diagnostics, including helper/primary install counts and the currently suggested refresh target.

---

## Persistence model (SQLite)

Primary tables:

- `settings`
- `ipas`
- `device_snapshots`
- `jobs`
- `job_steps`
- `job_command_runs`
- `installs`
- `logs`
- `scheduler_state`
- `users`
- `sessions`
- `auth_attempts`

### Migration strategy

- base tables are created with current schema
- additive safety migrations are applied using `PRAGMA table_info(...)` + `ALTER TABLE ... ADD COLUMN`
- existing DB files are upgraded in-place without destructive reset

---

## Auth/session hardening

- Passwords: salted `scrypt`
- Session tokens: random + SHA-256 stored hash
- Failed login lockout policy (per username/IP key), persisted in SQLite across process restart
- Session pruning keeps max recent active sessions per user
- Mutating routes protected by auth middleware
- Response hardening headers (CSP, anti-framing, nosniff, restrictive permissions policy)
- API responses (`/api/*`) force `Cache-Control: no-store` to prevent sensitive state caching
- Diagnostics responses (`/api/logs`, `/api/jobs/:id/commands`, `/api/support/snapshot`) redact common secret patterns and sensitive context keys before payload export
- Helper endpoints optionally authorize via helper token header (`x-sidelink-helper-token`)

---

## Helper app architecture

In-repo SwiftUI helper (`ios-helper/SidelinkHelper`) provides:

- install + refresh health visibility
- next auto-refresh window visibility
- backend connectivity panel
- helper-token-authenticated refresh trigger

Build/export scripts:

- `scripts/helper-build.sh`
- `scripts/helper-export.sh`

Both scripts detect missing Xcode/xcodegen and fail with explicit unblock instructions.

---

## Desktop packaging path

- `npm run desktop:easy` is the local one-command entrypoint: migrate/reset admin on a known dev DB (`tmp/desktop/sidelink.sqlite`), clear stale auth lockouts, then launch desktop
- `npm run desktop:dev` builds server/client, runs `desktop:preflight` (native ABI verification + auto-heal), then launches the Electron shell
- `npm run desktop:package` packages macOS dir target and runs the same `desktop:preflight` path to keep native modules Electron-compatible

---

## Host Node native preflight path

- `scripts/node-native-preflight.cjs` verifies host Node can load `better-sqlite3`
- npm lifecycle hooks auto-run `node:preflight` for `web`, `dev`, `test`, `test:watch`, `db:migrate`, and `db:bootstrap`
- this keeps host-Node workflows resilient after Electron-specific dependency rebuilds

## Known constraints

- Real install/sign execution still depends on local Apple signing/provisioning/toolchain state
- Helper IPA export requires full Xcode environment
- Demo mode intentionally keeps deterministic simulation behavior for safe test iteration

These constraints are surfaced in API/UI with explicit recovery actions.
