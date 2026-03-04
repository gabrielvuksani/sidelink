# Implementation Audit — Current Snapshot (2026-03-03, overnight pass)

## Scope audited

- Server orchestration (`src/server/**`)
- Frontend control center (`src/client/**`)
- Persistence (`src/server/state/store.ts`)
- Tests (`tests/**`)
- Packaging/docs (`package.json`, `README.md`, `ARCHITECTURE.md`)

---

## 1) Product identity and compatibility

### Current state

- Product naming is Sidelink across app/docs/package metadata.
- Primary env namespace is `SIDELINK_*`.
- Backward compatibility for legacy `ALTSTORE_*` vars remains in place.

### Status

✅ Productized identity is in place without breaking legacy env setups.

---

## 2) Core backend capabilities

### Implemented

- Auth/session system (scrypt + lockout + session pruning)
- IPA import/inspection
- Device discovery (real adapter with mock fallback)
- Install pipeline with persisted step machine + command audits
- Guarded real worker execution gates
- Scheduler with 48h pre-expiry planning and Wi‑Fi preference
- Helper token + helper status/doctor/refresh endpoints
- SQLite persistence for jobs/installs/scheduler/logs/auth

### New reliability upgrades in this pass

- **Interrupted-job recovery on boot:** queued/running jobs from prior session are auto-marked as actionable errors (prevents stale dead UI states).
- **Duplicate-request hardening:** in-flight install key tracking reinforces duplicate suppression for identical mode+device+IPA requests.
- **Helper ensure smart skip:** helper reinstall is skipped when an existing helper lifecycle on target device has >24h remaining.
- **Helper target diagnostics:** `/api/helper/status` now returns suggested refresh target + policy metadata aligned with `/api/helper/refresh` behavior.
- **Strict mode input validation:** invalid runtime mode values are now rejected with `MODE_INVALID` on `/api/mode`, `/api/devices`, `/api/install`, and `/api/helper/status` instead of silently falling back to demo mode (case-insensitive `demo`/`real` still accepted).
- **Helper token scope hardening:** helper-token calls to `/api/helper/refresh` now require explicit `installId` or `deviceId`; unscoped token refresh requests are rejected.

---

## 3) Scheduler robustness + clarity

### Current planner behavior

- 7-day expiry model
- 48h pre-expiry auto-refresh window
- Wi‑Fi preferred, retry/backoff when unavailable
- Transport fallback after Wi‑Fi wait retries are exhausted

### New clarity telemetry in this pass

Per-install persisted auto-refresh state now includes:

- `nextAttemptReason`
- `lastDecisionCode`
- `wifiWaitRemainingRetries` (when applicable)

This improves both UI explainability and operational debugging.

---

## 4) Helper diagnostics improvements

`/api/helper/doctor` now includes additional readiness checks for:

- helper build script presence
- helper export script presence
- helper artifact directory presence

Action recommendations now explicitly call out missing scripts/directories.

---

## 5) Frontend UX wiring upgrades

### Improvements in this pass

- Action-level pending states (auth/mode/upload/install/refresh/scheduler/helper/commands/manual refresh)
- Buttons/inputs disable while requests are in-flight to prevent duplicate clicks and dead transitions
- Loading labels for in-flight actions
- Command explorer now handles stale job selection more gracefully
- Selected job row highlighting for command audit context
- Lifecycle cards now display richer scheduler intent:
  - next-attempt reason
  - decision code
  - backoff minutes
  - remaining Wi‑Fi wait retries

### Outcome

✅ Better UX polish and fewer dead/intermediate UI states.

---

## 6) Safety/compliance posture

Still enforced:

- no jailbreak flow
- no enterprise/distribution signing abuse
- no piracy paths
- real execution requires explicit env + API confirmation + real device provenance
- HTTP hardening headers are now applied globally (CSP, anti-framing, nosniff, restrictive permissions policy)
- `/api/*` responses now force `Cache-Control: no-store` to reduce sensitive-state caching exposure

---

## 7) Tests and docs sync

### Added/expanded tests

- `tests/pipeline-recovery.test.ts` (restart recovery for interrupted jobs)
- `tests/helper-orchestration.test.ts` (skip helper reinstall when already healthy)
- `tests/helper-refresh.test.ts` (helper status diagnostics + suggested target)
- `tests/mode-validation.test.ts` (strict mode input validation across auth-protected API routes)
- `tests/security-headers.test.ts` (CSP/security-header + no-store API cache policy assertions)
- Scheduler assertions expanded for new auto-refresh telemetry
- Persistence assertions expanded for new auto-refresh fields
- Queue test timeout hardening for stability under full-suite load

### Docs updated in this pass

- `README.md`
- `ARCHITECTURE.md`
- this audit document

---

## 8) Remaining environment constraints

- Real signing/install still depends on local Apple toolchain + provisioning setup.
- Helper IPA export still requires proper macOS/Xcode environment.

These are expected platform constraints, not product regressions.

---

## 9) Productization continuation milestone (2026-03-03, morning)

### Added this pass

- `GET /api/support/snapshot` (auth-gated diagnostics export)
  - optional controls: `includeLogs`, `logLimit`, `includeCommands`, `download=1`
  - command runs are summarized with stdout/stderr lengths instead of raw command output payloads
- `/api/health` now includes runtime/package metadata:
  - app `startedAt`, `uptimeSeconds`
  - package name/version
  - Node/platform/arch/pid runtime details
- Added integration coverage in `tests/support-snapshot.test.ts` for auth gating, export controls, and health metadata shape.

### Why it matters

This gives operations/support a single machine-readable snapshot endpoint for debugging and handoff without opening SQLite directly, while keeping the payload safer by default.

---

## 10) Productization continuation milestone (2026-03-03, daytime pass)

### Added this pass

- Web UI support-handoff action:
  - **Operational Logs** card now includes **Download support snapshot** button
  - exports `/api/support/snapshot` JSON (logs + command summaries) directly from control center
- Build reliability hardening:
  - added `npm run clean` (`rm -rf dist`)
  - `npm run build` now performs a clean rebuild to prevent stale dist artifacts from being packaged
- README updates reflect both changes:
  - documented `npm run clean`
  - documented clean-build behavior and UI snapshot export shortcut

### Why it matters

- Support snapshot export is now one click in UI (no manual API call needed), reducing triage friction.
- Clean builds eliminate stale artifact drift in packaged desktop outputs, improving release determinism.

---

## 11) Productization continuation milestone (2026-03-03, diagnostics filtering pass)

### Added this pass

- `GET /api/logs` now supports bounded diagnostics filtering:
  - `level` (comma-separated log levels)
  - `code` (case-insensitive code match)
  - `search` (case-insensitive text over code/message/action/context)
  - `before` / `after` (ISO timestamp window)
- `/api/logs` responses now include `meta` (`returned`, `matched`, `totalStored`, `hasMore`, active filters) for operational triage.
- `GET /api/support/snapshot` now accepts the same log filters via prefixed params:
  - `logLevel`, `logCode`, `logSearch`, `logBefore`, `logAfter`
- Support snapshot payload now includes `logsMeta` to describe applied log filters and match counts.
- Web UI **Operational Logs** card now includes inline level/search controls and keeps support snapshot export aligned with active filters.

### Verification added

- New integration coverage in `tests/log-filters.test.ts` for `/api/logs` filtering, invalid filter validation, and snapshot filter passthrough.

### Why it matters

- Faster incident triage: operators can isolate error windows quickly instead of scanning full log streams.
- Better support handoff payload quality: snapshots can be scoped to the relevant timeframe/signal while preserving deterministic metadata about what was included.

---

## 12) Productization continuation milestone (2026-03-03, desktop brand-pack pass)

### Added this pass

- Added branded desktop icon assets under `build/icons/`:
  - `icon.icns` (packaging target)
  - generated iconset + PNG source exports for future iteration
- Added reproducible icon generator script:
  - `scripts/generate-icon-assets.py`
  - `npm run icon:generate`
- Updated Electron Builder mac config in `package.json`:
  - `build.mac.icon = "build/icons/icon.icns"`
- Updated README desktop packaging notes to document icon generation + icon source path.

### Verification

- `npm run desktop:package` completes and no longer emits the "default Electron icon is used" warning.

### Why it matters

- Packaged desktop artifacts now carry product branding by default instead of Electron’s generic icon.
- Release output is closer to shippable quality with no manual post-package icon patching.

---

## 13) Productization continuation milestone (2026-03-03, mode persistence hardening pass)

### Added this pass

- Fixed runtime mode restoration to persist **both** explicit values (`demo` and `real`) across app restarts.
  - Previously, persisted `demo` could be overridden when startup default was `real`.
  - Store bootstrap now restores saved mode whenever it is a valid runtime mode.
- Added regression coverage in `tests/mode-persistence.test.ts` to validate:
  - `demo -> real` persistence across restart
  - `real -> demo` persistence even when restart default flips to `real`

### Verification

```bash
npm run lint
npm test
npm run build
npm run desktop:package
```

### Why it matters

- Runtime mode behavior is now deterministic and user-intent-preserving across restarts.
- Prevents surprise mode flips caused by environment default drift, which is critical for safe real/demo execution posture.

---

## 14) Productization continuation milestone (2026-03-03, support snapshot filtering hardening pass)

### Added this pass

- Extended `GET /api/support/snapshot` with optional **job filters + bounding**:
  - `jobLimit`, `jobStatus`, `jobMode`, `jobDeviceId`, `jobIpaId`, `jobBefore`, `jobAfter`
- Extended snapshot command summaries with optional **command filters + per-job limits** when `includeCommands=1`:
  - `commandLimit`, `commandStatus`, `commandStepKey`, `commandSearch`, `commandBefore`, `commandAfter`
- Added `jobsMeta` and `commandRunsMeta` to snapshot payload for deterministic support handoff context:
  - requested limits
  - matched/returned counts
  - active filters
  - per-job command summary match metadata
- Refactored route-local filter parsing helpers so prefixed support snapshot filters reuse the same validation and semantics as `/api/jobs` + `/api/jobs/:id/commands`.

### Verification

```bash
npm run lint
npm test -- tests/support-snapshot.test.ts
npm test
npm run build
npm run desktop:package
```

### Why it matters

- Support snapshots can now be scoped to the relevant failing jobs/command windows instead of dumping full job history.
- Payload size and noise are better controlled for handoff/debugging while preserving strict validation and transparent metadata.
