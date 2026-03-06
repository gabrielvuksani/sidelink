# ARCHITECTURE.md

## Goal

Sidelink is a cross-platform, production-ready personal iOS sideload manager with three priorities:

1. Premium operational UX (guided wizard, desktop auto-update, keyboard shortcuts)
2. Pure TypeScript signing engine (zero native codesign dependency)
3. Autonomous 48h pre-expiry refresh scheduling (Wi-Fi preferred)

All while preserving safety constraints (no jailbreak / no enterprise abuse / no piracy).

---

## High-level components

- **Express API server** (`src/server/app.ts`)
  - Auth, Apple account management, IPA import, device discovery, install pipeline, scheduler controls, structured logs
  - Security middleware: rate limiting (token bucket), input validators, CSP headers, log redaction
- **Context bootstrap** (`src/server/context.ts`)
  - Sync (legacy) and async (keychain) bootstrap modes, environment resolution, full service wiring
- **SQLite database** (`src/server/state/database.ts`)
  - WAL mode, 14 tables, AES-256-GCM encrypted secrets, transactional migrations
- **Auth service** (`src/server/services/auth-service.ts`)
  - Admin bootstrap, scrypt password hashing, session management, lockout policy
- **Apple account service** (`src/server/services/apple-account-service.ts`)
  - Apple ID authentication via SRP protocol (Python anisette helper), session persistence
- **Device service** (`src/server/services/device-service.ts`)
  - iOS device discovery via pymobiledevice3, USB/Wi-Fi transport detection
- **IPA service** (`src/server/services/ipa-service.ts`)
  - IPA parsing, entitlement extraction, metadata management
- **Provisioning service** (`src/server/services/provisioning-service.ts`)
  - App ID, certificate, and profile management via Apple Developer Services
- **Pipeline** (`src/server/pipeline/pipeline.ts`)
  - 6-step install orchestration with per-device mutex, 2FA pause/resume, crash recovery
- **Signing engine** (`src/server/signing/`)
  - **ts-signer.ts** — Pure TypeScript IPA re-signing (cross-platform, no codesign/zsign needed)
  - **macho.ts** — Mach-O binary parser (FAT/universal, segment/LC parsing)
  - **codesign-structures.ts** — Apple code signature blob construction (SuperBlob, CodeDirectory, CMS)
  - **signing-utils.ts** — Bundle ID rewriting, entitlements, shared helpers
- **Security utilities** (`src/server/utils/`)
  - **security.ts** — Token bucket rate limiter, sanitization helpers, validation utilities
  - **validators.ts** — Typed request validators for all API routes
  - **keychain.ts** — OS keychain (keytar) + PBKDF2-100k fallback encryption
  - **crypto.ts** — AES-256-GCM encryption providers
  - **redaction.ts** — Credential/key/token scrubbing for logs
  - **errors.ts** — Typed error hierarchy (12 error classes)
- **Scheduler service** (`src/server/services/scheduler-service.ts`)
  - Lifecycle model, 48h planner, Wi-Fi-preferred retry/backoff, persisted telemetry
- **Desktop wrapper** (`src/desktop/main.ts`)
  - Electron 36 shell, auto-updater, native file dialogs, IPC bridge
- **Frontend** (`src/client/`)
  - React 19 + Vite 7 + Tailwind CSS 4 SPA
  - **SetupWizard** — 6-step guided onboarding with slide animations
  - **UpdateBanner** — Desktop auto-update notifications
  - **Keyboard shortcuts** — Cmd/Ctrl+1-8 navigation
  - Pages: Dashboard, Apple Account, Devices, Apps, Install, Installed, Logs, Settings
  - Infrastructure: ToastProvider, ConfirmProvider, SSE with exponential-backoff, typed API client
- **iOS helper** (`ios-helper/SidelinkHelper/`)
  - SwiftUI companion app for on-device refresh status

---

## Install pipeline sequence

`startInstallPipeline()` creates a job and runs steps with per-device mutex:

1. `validate` — verify IPA exists, parse metadata
2. `authenticate` — ensure Apple account session is valid
3. `provision` — register device, create App ID, cert, profile
4. `sign` — re-sign IPA with the new provisioning assets
5. `install` — push signed IPA to device via pymobiledevice3
6. `register` — record in installed_apps for refresh tracking

### Pipeline safety

- Per-device promise-chain mutex prevents signing/install collisions
- Each step emits real-time SSE updates
- 2FA pause/resume with 5-minute timeout
- Stalled jobs recovered to error state on startup

---

## Cross-platform signing engine

The TypeScript signing engine (`src/server/signing/ts-signer.ts`) performs complete IPA re-signing without any native `codesign` dependency:

1. **Unpack** IPA (ZIP) and locate `.app` bundle
2. **Parse** Mach-O binaries (FAT/universal, 32/64-bit) to read load commands
3. **Construct** CodeDirectory hash (SHA-256) over all code pages
4. **Build** CMS signature using node-forge (PKCS#7/DER-encoded)
5. **Assemble** SuperBlob (CodeDirectory + Requirements + signature + entitlements)
6. **Inject** signature into `__LINKEDIT` segment of each binary
7. **Write** provisioning profile + entitlements + updated `Info.plist`
8. **Repack** as signed IPA

This runs on macOS, Windows, and Linux — no Xcode or Apple toolchain required.

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

- `settings` — key/value config and schema version tracking
- `apple_accounts` — Apple ID auth state (password AES-encrypted)
- `certificates` — signing certificates + encrypted private keys
- `app_ids` — registered Apple App IDs
- `provisioning_profiles` — provisioning profile blobs
- `device_registrations` — per-account device portal registrations
- `ipas` — uploaded IPA metadata (bundle ID, entitlements, icons)
- `jobs` — install pipeline jobs with inline `steps_json`
- `job_command_runs` — per-job command audit trail (added in migration v2)
- `installed_apps` — installed app records with expiry tracking
- `logs` — structured log entries
- `users` — dashboard users (scrypt-hashed passwords)
- `sessions` — session tokens (SHA-256 hashed)
- `auth_attempts` — login attempt audit for lockout policy

### Migration strategy

- `SCHEMA_VERSION` constant tracks the target version; `settings.schema_version` tracks the DB's current version
- Base schema (v1) is created via `CREATE TABLE IF NOT EXISTS` on first run
- Incremental migrations (v2+) are defined in a typed `MIGRATIONS` array and applied transactionally in order
- Each migration bumps the persisted version inside the same transaction
- `hasColumn(table, column)` helper available for safe `ALTER TABLE ADD COLUMN` guards
- Existing DB files are upgraded in-place without destructive reset

---

## Auth/session hardening

- Passwords: salted `scrypt`
- Session tokens: random + SHA-256 stored hash
- Failed login lockout policy, persisted in SQLite across restarts
- Session pruning keeps max recent active sessions per user
- All mutation routes protected by auth middleware
- Response headers: CSP, X-Frame-Options DENY, nosniff, Permissions-Policy
- API responses force `Cache-Control: no-store`
- Diagnostic outputs auto-redact credentials/tokens/keys

---

## Security middleware

### Rate limiting (token bucket algorithm)

| Endpoint class | Limit | Window |
|---|---|---|
| Auth (login/setup) | 10 requests | 1 minute |
| Apple API (sign-in/2FA) | 5 requests | 1 minute |
| File uploads | 10 requests | 5 minutes |
| General API | 120 requests | 1 minute |

- Per-IP keying with `Retry-After` and `X-RateLimit-*` headers
- Periodic bucket cleanup (60s interval, 5min stale threshold)
- `.unref()` on cleanup timer to prevent process hanging

### Input validation

Typed request validators (`src/server/utils/validators.ts`) on all mutation routes:
- `authSetup` — username regex `^[a-zA-Z0-9_-]+$`, password ≥ 8 chars
- `authLogin` — username + password required
- `appleSignIn` — email format validation
- `apple2FA` — 6-digit code check
- `startInstall` — accountId, ipaId, deviceUdid all required as valid UUIDs/UDIDs
- `schedulerUpdate` — interval range enforcement (60s–24h)

All string inputs are trimmed and sanitized (null bytes, control characters stripped).

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

- Real install execution depends on pymobiledevice3 and device connectivity
- Helper IPA export requires full Xcode environment
- Apple auth requires Python anisette/SRP helpers
- Rate limiter state is in-memory (resets on restart — by design for simplicity)

These constraints are surfaced in API/UI with explicit recovery actions.

---

## Test coverage

**154+ tests across 11 suites** (Vitest, node environment):

| Suite | Tests | Coverage |
|---|---|---|
| `smoke.test.ts` | 4 | Module imports, error hierarchy, pipeline steps, defaults |
| `security.test.ts` | 13 | Sanitization, email/UUID/UDID validation |
| `validators.test.ts` | 17 | All route validators with mock Express objects |
| `crypto.test.ts` | 21 | AES-256-GCM round-trip, tampering, key derivation, keychain migration |
| `errors.test.ts` | 16 | All 12 error classes (codes, status codes, inheritance) |
| `redaction.test.ts` | 11 | Token/key/email/cookie redaction, object recursion |
| `constants.test.ts` | 13 | Shared constants integrity (limits, endpoints, pipeline steps) |
| `paths.test.ts` | 8 | Path resolution, ensureDir, platform detection |
| `pipeline.test.ts` | 3 | Pipeline utilities (listeners, 2FA state) |
