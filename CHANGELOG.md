# Changelog

## [0.8.8] - 2026-05-07

### Free-tier dev-cert provisioning now actually unblocks free-tier users

The friendly error in v0.8.7 (`ProvisioningError: Apple already has development certificates for this team that were not created by SideLink`) listed each unmanaged cert and told the user to revoke one at `https://developer.apple.com/account/resources/certificates/list`. That URL is **paid-only** — free Apple IDs get a 403 on that page because cert management is gated behind the Apple Developer Program. Free-tier users (i.e. the entire target audience for a sideload manager) had no way out: the link doesn't load for them, and the only other surface — Xcode → Settings → Accounts → Manage Certificates — needs Xcode plus the original private key. Two real test accounts hit this dead-end on this dev-log run with portal certs from prior Xcode use that they could not revoke.

**Fix:** `CertificateManager.ensureCertificate` now takes an `accountType: 'free' | 'paid' | 'unknown'` argument and applies tier-aware policy:

- **`'free'`** — auto-revoke EVERY unmanaged portal dev cert (active + expired) before submitting the new CSR. Free Apple IDs cap at 2 dev certs and have no portal to manage them, so the conservative "leave external certs alone" rule produced a permanent stuck state. AltStore and Sideloadly take the same approach.
- **`'paid'`** — unchanged. Auto-revoke only EXPIRED unmanaged certs (still occupy quota, useless for signing). Active unmanaged certs stay refused with the existing portal-link error — paid teams have a working portal AND legitimately share certs with Xcode/AltStore.
- **`'unknown'`** — same conservative behaviour as paid, but the error message now offers BOTH paths (Xcode for free, portal URL for paid) so users with regressed team detection can pick the right one.

Each external cert revoked under free-tier policy emits a `CERT_REVOKED` log with `reason: 'free-tier-quota'` (or `'expired'`), serial, portal ID, common name, and expiry — fully visible in the dashboard log stream so users see exactly what was reclaimed and why. The friendly error path's `certsToRefuse` list is now structurally empty for free-tier accounts (everything was already revoked above), so the misleading paid-only URL can never reach a free user even via a future regression that miswires the call.

Wired through both call sites: `provisioning-service.ts` (pipeline path) and `routes/apple.ts` (manual rotate-certificate endpoint) now pass `account.accountType` plus the `LogService`.

Plus a tiny lint hygiene fix: the `req` parameter on the `/apple/accounts` GET handler was unused; renamed to `_req` to silence TS6133.

### Verified

- `npx tsc -p tsconfig.json --noEmit`: clean
- `npx tsc -p src/client/tsconfig.json --noEmit`: clean
- `npm run lint`: clean
- `npm test`: 196/196 passed (190 baseline + 6 new in `tests/certificate-manager.test.ts` covering all three tiers, mixed expired/active mix, and cached-cert reuse)
- New tests assert: free-tier revokes ALL unmanaged certs and emits `CERT_REVOKED` with `reason: 'free-tier-quota'`; paid-tier refuses with the portal-only message and never includes the Xcode hint; unknown-tier surfaces both options; paid-tier still auto-revokes expired certs even when also refusing active ones; cache hit short-circuits all portal interaction.

## [0.8.7] - 2026-04-29

### Close every remaining race in the GSA flow + zero-vuln dependency baseline

Five issues — the three observed in the v0.8.6 dev-log run, plus two they uncovered when fixed.

**1. Concurrent pipeline auth still fired duplicate GSA round-trips for the same account.** When two install jobs entered the `authenticate` step at the same time (e.g. installing on two devices with one Apple ID), each called `refreshAuth` independently. Two `Starting GSA authentication via Python helper...` lines back-to-back. Apple sent two 2FA pushes for what should have been one sign-in, and `pending2FAContexts[appleId]` in `apple-auth.ts` was overwritten by the second call so the first job's adsid/idmsToken were lost.

Fix: `AppleAccountService.refreshAuth` now coalesces concurrent calls per accountId via `inflightRefresh`, mirroring the v0.8.6 `inflightReauth` pattern but for the pipeline path. Two pipeline jobs share one GSA round-trip and one 2FA push.

**2. `2FA validation error 401: HTTP 401` logged twice for the same account.** Same root cause but downstream: desktop UI + iOS helper (or React StrictMode + a fast double-click) both POSTed `/apple/accounts/:id/reauth/2fa` for the same code. The pending 2FA context on Apple's side is single-use; the second submission produced a 401 the moment Apple saw it.

Fix: `complete2FAForAccount` now coalesces per accountId via `inflight2FA`, and short-circuits when `account.status === 'active'` and the session cache is fresh. The second caller either awaits the first or returns the already-active account — no second Apple round-trip.

**3. Two-job 2FA required two keystrokes from the user.** With (1) and (2) fixed, two pipeline jobs for the same account share one upstream Apple challenge — but each job's `pauseForTwoFactor` still had its own `pending2FA[jobId]` waiter, so the user had to type the same code twice in the dashboard.

Fix: `TwoFAWaiter` now stores `accountId`. On any `submitJobTwoFA(jobId, code)`, the function captures every sibling waiter for the same accountId and resolves them all with the same code. Each sibling's `complete2FAForAccount` then short-circuits through the active-status check from (2). One keystroke, N jobs unblocked.

**4. ProvisioningError gave no actionable detail when Apple's portal had certs SideLink didn't manage.** v0.8.6 fixed the case where SideLink had quarantined-but-known certs. This run uncovered the case where the user has *unrelated* dev certs in the portal (e.g. from Xcode), some of which are already expired but still count against the free-account 2-cert quota.

Fix: in `certificate-manager.ensureCertificate`, expired unmanaged portal certs are now auto-revoked through the API (they are useless for code-signing — any signature with an expired cert is rejected by iOS). Active unmanaged certs are still left alone, but the `EXTERNAL_DEV_CERT_PRESENT` error now lists each one with CN, last-8 of serial, and expiry date, plus a direct link to `https://developer.apple.com/account/resources/certificates/list` so the user can match and revoke a specific cert in seconds.

**5. tsx watch force-killed the dev server before our shutdown handler finished.** Dev log: `^C ... Shutting down gracefully... [tsx] Previous process hasn't exited yet. Force killing...`. Our drain watchdog was set to 8s, but tsx watch's grace period is ~5s before SIGKILL.

Fix: drain timer reduced from 8s to 3s. SSE responses are already destroyed synchronously and connections drained, so 3s is plenty for a healthy shutdown and short enough to fit inside tsx's grace window.

### Dependency security baseline

`npm audit` went from `5 vulnerabilities (4 moderate, 1 high)` to `found 0 vulnerabilities`:

- `electron`: `^36.1.0` → `^39.8.9` — closes 5 advisories (use-after-free in offscreen window paint, use-after-free in fullscreen permission callbacks, use-after-free in PowerMonitor, use-after-free in download dialog, AppleScript injection in `moveToApplicationsFolder`, CLI switch injection, registry-path injection, second-instance OOB read, service-worker IPC spoof, iframe origin in permission handler, nodeIntegrationInWorker leakage, login-item path quoting). Desktop code uses only stable APIs (`BrowserWindow`, `ipcMain`, `webContents`, `app`) so no migration needed.
- `better-sqlite3`: `^11.8.1` → `^12.9.0` — required because Electron 39's bundled V8 removed `v8::Context::GetIsolate()`, which `better-sqlite3@11`'s native module called. The 12.x API is backwards-compatible with our usage.
- `uuid`: `^13.0.0` → `^14.0.0` — closes the v3/v5/v6 buffer-bounds advisory. We only use `v4`, so unexploitable, but cleans the audit.
- `vitepress` overrides — pinned its transitive `esbuild` to `^0.25.0` and its transitive `vite` to `^6.4.2` to close two dev-server advisories (vitepress 1.6.4 still builds cleanly against these; verified via `docs:build`).

Plus a few small hygiene fixes the LSP flagged when the surrounding code was touched: deleted dead `crypto` import in `certificate-manager.ts`, dead `getDefaultDataDir` import in `index.ts`, and unused destructured deps in `pipeline.ts:306` / `pipeline.ts:448`.

### Verified

- `npm audit`: 0 vulnerabilities (was 5: 4 moderate + 1 high)
- `npx tsc -p tsconfig.json --noEmit`: clean
- `npx tsc -p src/client/tsconfig.json --noEmit`: clean
- `npm test`: 190/190 passed
- `npm run build`: clean (clean → tsc → vite → asset copy)
- `npm run docs:build`: clean (vitepress with new overrides)
- `npx electron-builder install-app-deps` against Electron 39.8.9: better-sqlite3 + keytar both rebuild cleanly for arm64
- `npm run desktop:preflight`: native dependency check passed
- Server boot smoke test through to `initKeychain` (further boot blocked only by an unrelated keychain fingerprint mismatch on the dev machine's existing data dir)
- iOS helper API contract preserved: `helper.ts`'s `/apple/*` routes return identical envelopes; `APIClient.swift`'s `reauthenticateAppleAccount` and `submitAppleAccountReauth2FA` continue to work without iOS-side changes.

## [0.8.6] - 2026-04-22

### Unblock install pipeline when a cert was quarantined on a previous boot

Three tightly-related issues from the v0.8.5 dev-log report:

**1. `ProvisioningError: Apple already has development certificates for this team that were not created by SideLink`**. After v0.8.5 quarantined the stale-encryption cert, the matching portal cert on Apple's side became invisible to the cert manager — `listCertificates` skipped the quarantined row because its private key is undecryptable, so the cert-manager's "which portal certs are ours?" filter came up empty, and the still-present portal cert was classified as "unmanaged", refusing the free-account 2-cert limit. Result: the user was stuck with no way forward.

Fix: new `Database.listCertificateOwnership(accountId)` that returns just the non-sensitive metadata (id, portalCertificateId, serialNumber, revokedAt) WITHOUT attempting to decrypt. Cert manager's ensure-cert path now uses ownership rather than decoded records to decide which portal certs are ours, so quarantined certs are correctly revoked to make room for a new CSR. After portal revocation the local quarantined row is hard-deleted (not just marked revoked) so it doesn't linger as dead weight on every subsequent pipeline run.

**2. Pipeline "hangs on nothingness"**. The dev terminal showed `JOB_STARTED` then silence. Root cause: step-level progress went to `logJobLine` (DB + SSE) but never to the top-level console. A stuck network call to Apple inside `provision` looked identical to a job making progress.

Fix: `runStep` now emits `[INFO] [JOB_STEP] <jobId> → <step>` at start and `[INFO] [JOB_STEP] <jobId> ✓ <step> (<ms>ms)` on completion to the top-level console. Plus a new per-step timeout: 30s for validate / register, 3min for sign / install, 15min for authenticate / provision (which include the 10-min 2FA wait). When a step exceeds its budget the pipeline fails with `STEP_TIMEOUT: Step "X" timed out after Ys — likely stuck on an Apple portal call, keychain prompt, or device response`. No more silent hangs.

**3. Re-auth spiral + desktop↔iOS helper 2FA collision**. The dev log showed the same account hitting `APPLE_AUTH_STARTED Re-authenticating` 7+ times in a row, each triggering a fresh 2FA push. Cause: the dashboard and the iOS helper were both POSTing `/apple/accounts/:id/reauth` as part of their auto-refresh. Apple invalidates earlier verification sessions when a new GSA round-trip starts, so when the user finally entered a code Apple had already discarded the session it was tied to → HTTP 401.

Fix: `AppleAccountService.reauthenticate` now coalesces concurrent calls per accountId via an `inflightReauth` Map. The second caller awaits the first promise instead of starting a parallel GSA round-trip. The iOS helper and the desktop UI can both call reauth simultaneously and they'll share the same pending 2FA prompt instead of invalidating each other.

### Verified
- `npx tsc` clean server + client
- 190/190 tests pass
- Against the user's actual broken DB: `listCertificates` returns 0 (quarantined skipped), `listCertificateOwnership` returns the quarantined row with portalId/serial so cert-manager can match + revoke the Apple-side cert
- Pipeline now logs `[JOB_STEP]` transitions at the top level

No runtime behaviour changed for users whose DBs are already healthy — all three fixes activate only on the failing code paths.

## [0.8.5] - 2026-04-22

### Runtime bug fix: auto-quarantine stale-encryption cert rows

The v0.8.4 fingerprint sentinel correctly protects *new* writes, but it can't rescue data already on disk that was encrypted under an older key (e.g. because a previous keytar timeout silently fell back to the machine-derived key). A stale cert row would then survive startup — the fingerprint matches the *current* key, but the row can't be decrypted — and the first install attempt would crash with `DecryptContextError: Failed to decrypt certificate ...`.

Fix: `Database.getActiveCertificate` / `listCertificates` / `getCertificateById` now catch decrypt errors per-row, mark the offending row `revoked_at = now()` in place, and continue. `getActiveCertificate` falls through to the next unrevoked candidate, or returns `null`. A `null` here triggers the cert-manager's fresh-CSR path on the next pipeline run, which transparently recovers the install.

The row is deliberately **revoked rather than deleted** so the `portal_certificate_id` stays available — the cert manager will later list Apple's portal certs and revoke the orphan there too, preventing silent App-ID quota exhaustion.

Verified against the real user-reported broken DB: `revoked_at: null → '2026-04-22T02:41:03.614Z'` on first call, clear `[database] Quarantined undecryptable certificate id=...` log, `getActiveCertificate` returns null → fresh CSR triggered.

## [0.8.4] - 2026-04-21

### Runtime bug fixes — the three issues the v0.8.x dev log surfaced

- **Keychain fingerprint sentinel actually implemented.** v0.7.0 / v0.8.0 both claimed this shipped but the file was never changed. `src/server/utils/keychain.ts` now computes `SHA-256('sidelink-key-fp-v1' || keySource || masterKey)` and writes it to `<dataDir>/.master-key.fp` on first run. On every subsequent boot the hash is recomputed and compared; a mismatch throws `KeyFingerprintMismatchError` with a clear remediation playbook **before** the pipeline has a chance to try decrypting anything. Also: keytar timeout extended from 5s to 15s + single retry, and the cached key source is surfaced in error messages. This eliminates the `"Unsupported state or unable to authenticate data"` GCM error class that triggered mid-pipeline on every keychain drift.
- **`safeDecrypt()` helper with structured error context.** New `src/server/utils/safe-decrypt.ts` wraps every decrypt call with a record-kind / id / field. A GCM auth-tag mismatch now surfaces as `Failed to decrypt certificate id=... field=privateKeyPem: ...` instead of the opaque node:crypto message. Wired into `Database.mapCertRow` and all three Apple-account password decrypts.
- **Shutdown leak fixed — no more tsx `"Force killing..."`**. SSE keepalive `setInterval`s in `routes/system.ts` and `routes/helper.ts` are now `.unref()`'d, the pipeline cancelled-job auto-cleanup `setTimeout` is `.unref()`'d, and `closeAllSSE()` now destroys the underlying socket synchronously so `server.close()` can drain. Verified: SIGINT produces `"Shutting down gracefully..." → "Goodbye."` within ~2s.

### Verified

- `npx tsc` clean on server + client
- 190/190 tests pass
- Fresh dev-server start creates `.master-key.fp` (64-byte SHA-256 hex, mode 600)
- Tampered fingerprint file → server refuses to start with full remediation printed
- SIGINT shutdown completes cleanly — no force-kill

### Non-fix: `npm audit`

1 high + 3 moderate vulnerabilities remain, but `npm audit --production` shows **0**. All 4 are in dev-only deps: the high is Electron 36.x→41.2.2 (breaking-change major bump — deferred until a dedicated packaging validation pass), and the moderates are vitepress→vite→esbuild with no upstream fix yet.

## [0.8.3] - 2026-04-21

### CI / release hotfix (final)
- All GitHub Actions workflows (`ci.yml`, `docs.yml`, `release.yml`) now invoke `npx -y npm@11 ci` instead of the runner's bundled npm. Node 22 LTS ships npm 10 and has two blocking bugs for this lockfile: it demands a parallel `react@18` tree materialised for `@docsearch/react`'s `react<19` peer pin, and it silently skips platform-specific `optionalDependencies` (rollup, tailwindcss-oxide, esbuild binaries) during `npm ci` — breaking `vite build` on Linux and Windows (npm/cli#4828). Earlier attempts to install npm 11 globally or via corepack failed because GitHub runners shadow the shim or trip npm 10's own postinstall. `npx -y npm@11 ci` sidesteps both issues.
- Add `"overrides"` to `package.json` so `@docsearch/react`'s outdated `react<19` peer pin resolves against our top-level `react@^19.2.4` — eliminates the need for a parallel `react@18` install tree in the lock file altogether.
- Drop the `semver` npm package (never actually in `package.json`, only referenced in code) and the `@types/semver` dev dep. Replace with an inline `compareSemver()` helper in `install.ts` + `source-service.ts`. Rationale: pulling those deps forced a fresh `npm install` which stripped the nested-tree entries `npm ci` then demanded. Inline comparator sidesteps the whole resolution mess.
- Bump `.nvmrc` to `22` to match workflow runners.

No runtime behaviour changed between 0.8.0 / 0.8.1 / 0.8.2 / 0.8.3. This release exists solely to give all four platforms (mac-arm64, mac-x64, win, linux) a workflow-built DMG/installer.

## [0.8.2] - 2026-04-21

### CI / release hotfix
- Regenerate `package-lock.json` with npm 10 (matching CI's toolchain). vitepress ships `@docsearch/react` which pins `react < 19`, so npm 10 installs a parallel `react@18` tree under `@docsearch/js/node_modules/`. The lock file generated under npm 11 omitted this parallel tree, causing CI's `npm ci` to fail with "Missing: react@18.3.1 from lock file" on both the 0.8.0 and 0.8.1 tag builds. Both `npm@10 ci --dry-run` and `npm@11 ci --dry-run` now pass.
- No runtime code changed between 0.8.0 and 0.8.2. This release exists solely to give all four platforms (mac-arm64, mac-x64, win, linux) a workflow-built DMG/installer. The manually-built `SideLink-0.8.0-arm64.dmg` attached to the v0.8.0 GitHub release remains valid for arm64 users; anyone else should grab v0.8.2 assets.

## [0.8.0] - 2026-04-21

### Security — critical
- **iOS deep-link source import hardened**: `sidelink://source?url=…` now requires `https://`, strips Unicode control / bidi / NUL characters before display, rejects embedded userinfo, rejects loopback and RFC1918 literal hosts, and displays the resolved origin in bold on the confirmation sheet. A malicious Safari redirect can no longer silently import an attacker-controlled source.
- **iOS `AnyCodable` now throws on unknown shapes** instead of coercing to `NSNull`. A malformed or adversarial server manifest can no longer hide dangerous entitlements behind a silent "-" display.
- **iOS image decode cap**: `SidelinkImageDecoder.decodeBoundedBase64` enforces a 1 MiB ceiling on server-delivered icons, and `SidelinkAsyncImage` rejects non-https URLs. Memory exhaustion via oversized or attacker-scheme icons is no longer possible.
- **Server `SIDELINK_INTERNAL_TOKEN` removed from `process.env`**: the Electron main-process internal token is now passed explicitly as `createApp(ctx, { internalToken })` and lives only in the main-process closure. Spawned Python / system tool child processes can no longer inherit an authenticated token for the local HTTP server.
- **Server source-manifest SSRF guard**: adding or refreshing a source now DNS-resolves the https hostname and rejects any result that is loopback or RFC1918, closing the DNS-rebind / split-horizon smuggling vector.
- **Server device-registrar TOCTOU mutex**: a per-`(accountId, udid)` in-process mutex plus an idempotent DB upsert serialises concurrent pipelines for the same device so two installs can't both call `listDevices` / `registerDevice` and race the portal.
- **React `InstallModal` SSE `activeJobRef`**: the job-update handler now reads from a ref rather than the initial render closure, so the first update delivered immediately after `install()` is no longer dropped.
- **React Apple password no longer retained through 2FA in state**: credentials are captured to a ref and cleared from `useState` the instant the credential step succeeds.
- **React source-manifest images pass through `safeHttpsUrl()`** and render with `referrerPolicy="no-referrer"` + `crossOrigin="anonymous"` + `loading="lazy"`, so an attacker-controlled manifest can't leak the referrer or trigger non-https loads.
- **Scripts: `gsa-auth-helper.py` traceback scrubbed** from stderr on token-decrypt failure; diagnostics now route through `logging.debug` so the raw stack (which could include decoded session-key bytes) is no longer printed.
- **Scripts: `generate-source.cjs` protocol allowlist** — companion-JSON `iconURL` entries that aren't `https://` now fail the build loudly instead of being published into the source feed.

### Security — high
- `DELETE /api/install/apps/:id` now performs a best-effort on-device uninstall and removes the signed-IPA artifact before deleting the DB row. `?force=1` skips the device call for unreachable devices.
- `POST /auth/setup` is wrapped in an IMMEDIATE transaction and now returns `409` on duplicate admin (was `500` under concurrent setup-wizard tabs).
- Server `auth-service` no longer falls back to `require('../../../package.json')`; version detection uses `SIDELINK_APP_VERSION` or `npm_package_version` only. Packaged builds no longer silently skip the auth version-change migration because webpack stripped `package.json` from the module graph.
- `install.ts` update check uses `semver.coerce` + `semver.gt` rather than string compare, so `"1.10.0"` is correctly newer than `"1.9.0"`.
- Source aggregation (`combined()`) now picks the highest semver per `bundleIdentifier` instead of first-wins — a newer version shipped in a later-ordered source is no longer masked.
- `SchedulerService` persists `retryBackoff` alongside `refreshErrors`; a process restart no longer forgets device-disconnect backoff state and produces an immediate Apple-auth retry storm.
- `Database.runIdempotentMigrationSql` tolerates "duplicate column" errors on ADD COLUMN so reused dev databases that already have the columns don't crash on bootstrap.
- `postinstall` brew install is gated behind `SIDELINK_AUTO_INSTALL=1`; by default it prints the manual install line and exits clean.
- `release.sh` anchors the tag check (`refs/tags/$TAG$`) so `v0.7` no longer spuriously matches `v0.70.0`.
- `python-bundle/requirements.txt` pinning is aligned with `scripts/system-deps-preflight.cjs` — `srp==1.0.21`, `requests==2.32.3`, `cryptography==44.0.3`, rest are soft floors.

### iOS helper — Swift 6 concurrency and lifecycle
- **`SSEClient` rewritten**: all mutable state (`session`, `task`, `buffer`) is now serialised on a private `DispatchQueue` whose `OperationQueue` also backs the URLSession delegate callbacks. The class is `@unchecked Sendable` and callback properties are `@Sendable`-typed.
- **`HelperViewModel.deinit` no longer touches `@MainActor` state**: an explicit `invalidate()` method is called from the root view's `.onDisappear` to cancel install polling and SSE reconnect, with `deinit` left to handle only nonisolated subsystems.
- **`beginPollingInstallJob` re-weakens `self` per iteration** so a dismissed view model can be deallocated mid-poll rather than kept alive for up to 20 minutes by the strong capture.

### React client — correctness
- `HelperPairingPanel` only rotates the server-side pairing code on first mount when no warm snapshot exists. Route toggling no longer invalidates a QR / code the user is still entering.
- `useDesktopHealth.refresh` broadcasts results only to pollers that share the current `snapshotKey` prefix. Unrelated panels no longer receive each others' state.
- `SelfHostedEditor.parseManifestText` validates the shape of pasted JSON (name + apps[] of correctly-typed entries) instead of blindly casting to `SourceManifest`.
- `TimeAgo` (Dashboard) and `useTimeSince` (Devices) share a single `useSharedTick` driver so per-card `setInterval`s no longer multiply with dashboard row count.

### Features
- **AltStore-compatible source consumer expanded**: the trusted-sources seed list now ships AltStore Classic, AltStore Official, SideStore Community, and Quark Builder alongside the SideLink Official source. Any `{name, identifier, sourceURL, apps[]}` JSON feed can be added directly; duplicate bundle IDs across sources collapse to the highest semver at read time.
- **`POST /install` accepts `bundleIdStrategy`** (`"deterministic"` / `"randomized"`, default randomized) and `customDisplayName`. Randomized rewrites the bundle ID so multiple installs of the same IPA coexist on one device; custom display name replaces `CFBundleDisplayName` on the signed output so duplicates are distinguishable on the home screen.

### Documentation
- `docs/api-reference.md` expanded to cover every registered route — `/install/jobs/:id/cancel`, `/install/apps/updates`, `/install/apps/:id/deactivate|reactivate`, `/apple/app-ids`, `/apple/certificates`, `/apple/accounts/:id/rotate-certificate`, `/auth/reset`, `/ipas/import-path`, `/system/webhook`, and the full `/helper/*` surface were all missing.
- `bundleIdStrategy` + `customDisplayName` documented on the install body schema.
- All `v0.3.1` references across README / docs bumped to `v0.8.0`.
- `docs/official-source.md` explains the AltStore-compatible consumer story.

### Tests
- 190/190 passing after updating `integration.test.ts` to assert `409` (not `401`) on duplicate-admin setup — the previous expectation was the bug.

## [0.7.0] - 2026-04-21

### Security — critical
- **Keychain fingerprint sentinel**: master-key identity is hashed to `<dataDir>/.master-key.fp` and verified on every start. Silent-fallback drift (the root cause of "Unsupported state or unable to authenticate data" pipeline failures) is now caught at startup with a clear remediation.
- **Keytar retry + 15s timeout** (was 5s), logs routed through LogService.
- **Helper pairing token hashed in DB**: `helper_token_sha256` replaces the prior plaintext `helper_token` setting. Middleware re-hashes the inbound header and compares with `timingSafeEqual`. Legacy plaintext tokens auto-migrate on first boot.
- **Webhook SSRF guard**: PUT `/system/webhook` now rejects non-http(s) protocols, embedded credentials, loopback/RFC1918/link-local/`.local` hosts. `fireWebhook` re-validates at call time (defence-in-depth against direct DB writes).
- **Signing temp files overwritten before unlink** (`secureUnlink`): key/cert/PKCS12 PEMs get a two-pass random+zero wipe before removal on both success and failure paths.
- **Signing workDir cleaned on both success and failure**.
- **iOS helper: HTTPS/loopback required for Apple credential endpoints** (`requireSecureTransport`). Bearer-token header sanitised against CR/LF/ctrl-char injection. Multipart filename sanitised + moved to `Data(.utf8)` away from force-unwraps.
- **iOS helper: password no longer re-transmitted on 2FA submit**. Desktop caches it in the pending-session map for the 10-min TTL.
- **iOS helper: legacy `UserDefaults` `helperToken` fully removed after migration to Keychain** (not just emptied).
- **iOS helper: UDP discovery origin validation** — packets from non-local IPs are dropped before JSON decode.
- **iOS helper: pair-payload size capped at 4 KB** before decode.
- **iOS helper: SSEClient serialises all mutable state through a dedicated queue and is marked `@unchecked Sendable`** — removes the racy `disconnect()` path.
- **Apple auth: GSA Python helper stderr redacted** before logging (strips tracebacks, drops lines containing password/key material).
- **Apple auth: 2FA submission attempts capped at 5** per pending context; prevents Apple-side account lockout from stuck UI.
- **Apple auth: WWDR issuer verification** in `derToPem` before accepting a cert from the portal.
- **Apple auth: Apple resultCodes mapped to typed errors** (`APPLE_SESSION_EXPIRED`, `APPLE_AUTH_INVALID_CREDENTIALS`, `APPLE_CERT_REVOKED`, `APPLE_FREE_APP_ID_LIMIT`). Request retry no longer falls through to `undefined` on exhaustion.
- **Signing: removed `signingTime` from CMS** — non-reproducible and vulnerable to host clock skew. Not required by iOS.
- **Signing: stale temp keychains only deleted if mtime > 15 min** — fixes race where concurrent sign jobs clobbered each other.
- **Mach-O FAT parser: arch offset/size bounds validated**, BigInt guarded against JS safe-integer range.
- **Electron: `sandbox: true`**, explicit `webSecurity/nodeIntegrationInWorker/etc`, `will-navigate` + `setWindowOpenHandler` guards, `HOST=127.0.0.1` default (was `0.0.0.0`), deep-link action allowlist, IPC origin checks, shell-path allowlist (replacing the trivially-bypassable `..` blocklist), `window-state.json` schema validation.
- **Auto-updater: feed URL pinned in code** to `github:gabrielvuksani/sidelink` (overrides whatever `app-update.yml` contains).
- **React: SSE `event: close` frame + 5s reconnect cooldown**; EventSource re-check on fast unmount; fetch timeout via `AbortSignal.any`; `invalidateResponseCache` exposed + called on logout; outer `ErrorBoundary` now covers setup/login/auth shells; `lazyWithRetry` reloads once on stale-chunk failure.
- **Per-request correlation IDs**: `X-Request-Id` in + out, attached to 500-error logs and error-response bodies.
- **Security headers added**: Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy, Pragma on /api.
- **Home-directory allowlist on `/api/ipas/import-path`** (replacing forbidden-prefix blocklist vulnerable to symlink/casing tricks).
- **GitHub Actions**: workflow-level `permissions: read`, per-job `contents: write` only on release; Node 22 added to CI matrix; `timeout-minutes` everywhere; SHA256SUMS generated per build + verified in release; `softprops/action-gh-release` pinned to SHA; `workflow_dispatch` tag input validated against semver.
- **npm audit: 11 vulnerabilities → 0 production** (dev-only vitepress chain remains at 3 moderate, no upstream fix).
- **Python venv preflight**: sweeps `~pkg` orphan directories that caused "Ignoring invalid distribution" warnings; upgrades pip/setuptools/wheel before installs.

### Fixed
- **Device polling: 3-poll disconnect debouncing**. Transient WiFi hiccups no longer produce CONNECT/DISCONNECT log spam.
- **IPA upload: diagnostic error on invalid archive** — lists top-level entries + first 20 names so users can see what they actually uploaded.
- **tsx-watch shutdown**: timers unref'd across scheduler-service, device-service, discovery, SSE keepalive, keychain timeouts; `stopDiscovery` + `closeAllSSE` ordered before `server.close()`; SIGHUP handled; force-exit 3s.
- **Electron upgrade 36 → ^39.8.1** (closes 12 CVEs including use-after-free and command-injection).
- **Context: accidental `await` removed** from synchronous `createKeychainEncryptionProvider()`.

### Added
- iOS helper build target raised to iOS 17.0 (matches SwiftUI APIs already in use).
- `.githooks/pre-commit` hook strips staged AppleDouble (`._*`) files automatically.
- 11 new tests: keychain fingerprint verification, device disconnect debouncing, IPA diagnostic errors.

## [0.6.0] - 2026-03-22

### Security
- Auth reset endpoint now requires valid session when setup is complete (prevents unauthenticated credential wipe)
- Health endpoint no longer exposes full version string (shows major.minor only)
- CSRF skip list expanded to include `/auth/setup` and `/auth/reset` preventing 403 on first-time setup

### Fixed
- Device adapter: replaced silent `.catch(() => [])` with proper error logging — users now see WHY devices aren't showing up
- Device discovery: changed `Promise.all` to `Promise.allSettled` — if WiFi hangs, USB devices still appear
- Job log query efficiency: removed redundant `.reverse()` by changing SQL to `ORDER BY at ASC`
- API session expiry detection: made pattern matching more precise to avoid false positives
- Electron dev mode: client directory now auto-detects `dist/` subdirectory if index.html not at root
- Tray icon path: added existence check with logged warning when icon file missing

### Added — UI/UX Overhaul
- **Shared components**: EmptyState, ErrorCard, SkeletonLoader, ConnectionStatus, Breadcrumb — reusable across all pages
- **PageHeader**: loading spinner prop, proper aria-label
- **TabBar**: full keyboard navigation (arrow keys), ARIA tablist/tab roles, focus-visible styling
- **StatusBadge**: accessible labels and hover tooltips
- **DashboardPage**: animated stat count-up, "last updated" indicator, improved setup alerts with numbered steps and icons
- **AppsPage**: drag-and-drop upload zone with file preview, upload progress bar with ARIA attributes, empty state CTA
- **DevicesPage**: device type icons (iPhone/iPad), connection type badges with icons, "last seen" timestamps, troubleshooting tips, step-by-step empty state guide
- **SourcesPage**: source icons, app count per source, search/filter, "Popular Sources" suggestions when empty
- **Form validation**: Login page min-length + disabled state, Setup wizard password confirmation + strength, Apple ID email format validation
- **Accessibility**: aria-labels on all buttons, role attributes on interactive regions, reduced-motion media query support

### Added — iOS Helper
- Per-operation loading states instead of single boolean (granular UI feedback)
- Error queue (last 5 errors) instead of single error message (prevents overwrites)
- SSE max retry limit (10 attempts) with "Connection lost" message
- Swipe-to-delete on installed app cards
- "Expired" badge for apps past expiry date
- "Refreshing..." overlay during surface refresh
- Search debouncing (300ms) in browse tab
- "View All" buttons for truncated sections
- Onboarding step progress indicator with numbers
- Pairing troubleshooting tips when pairing fails

## [0.5.0] - 2026-03-22

### Fixed

- **Version reporting in packaged builds**: All endpoints that report server version now use `SIDELINK_APP_VERSION` with fallback chain, fixing `1.0.0` version strings in pairing codes, helper handshake, desktop health, and system info responses.
- **CSP enforcement**: Fixed logic inversion that disabled Content-Security-Policy in packaged builds when devtools were disabled (the exact opposite of intended behavior). CSP now always applies in packaged mode.
- **SPA fallback error handling**: `sendFile` for index.html now properly forwards errors to Express error handler instead of silently calling `next()` without context.
- **ExpiryBadge accuracy**: Fixed hours calculation that showed total hours instead of remaining hours within the day, and added `<1h` display for sub-hour expiry.
- **Accessibility**: Added `aria-expanded` to Collapsible component for screen readers.

## [0.4.4] - 2026-03-21

### Fixed

- Fixed version detection in packaged DMG builds: `require('../../../package.json')` fails inside asar bundles, causing the auth migration to silently skip and stale credentials to persist. Now uses `SIDELINK_APP_VERSION` env var set by Electron main process as primary source, with npm and require as fallbacks.
- Added session-based fallback: if version detection fails entirely, checks whether any valid sessions exist. If admin credentials exist but no sessions, treats it as stale state and clears for fresh onboarding.
- Fixed CSRF protection blocking the setup wizard: `POST /api/auth/setup` and `/api/auth/reset` were not in the CSRF skip list, causing the initial account creation to fail with a 403 on the first request before the CSRF cookie was set.
- Set `SIDELINK_APP_VERSION` env var from Electron's `app.getVersion()` so the server always knows the running version regardless of file path resolution.

## [0.4.3] - 2026-03-21

### Fixed

- Removed the Desktop Readiness gate that blocked the entire UI after onboarding. The gate waited for backend diagnostics (Apple runtime checks, xcodebuild probes) that could hang indefinitely. The app now renders immediately and loads health data asynchronously per-widget.

## [0.4.2] - 2026-03-21

### Fixed

- Fixed first-launch showing login instead of onboarding wizard when a database from a previous version or dev build persists. The app now tracks the setup version and automatically clears stale credentials on major.minor version changes so the setup wizard re-appears cleanly.

## [0.4.1] - 2026-03-21

### Added

- Added "Forgot credentials? Reset & start fresh" option on the login page that clears the admin account and re-triggers the setup wizard, solving the issue where persisted data from a previous install shows a login screen instead of onboarding on a fresh DMG launch.

### Fixed

- Confirmed first-launch onboarding wizard flow works correctly with account creation, Apple ID setup, device detection, and IPA upload steps.

## [0.4.0] - 2026-03-21

### Changed

- Redesigned the sidebar layout with a compact brand header and status indicator, removing verbose workspace and runtime info cards.
- Simplified the main header to show page title, short description, and a single primary action instead of redundant navigation buttons.
- Overhauled the Dashboard page: replaced the generic time-based greeting with contextual status summaries, removed the widget layout editor UI, and simplified the widget grid to a fixed responsive layout.
- Shortened all page descriptions across the app from verbose multi-sentence copy to concise one-liners.
- Upgraded the Install page with horizontal pipeline steppers, prominent 2FA input with amber styling and auto-focus, date-grouped job history, and dismissible verify-app hints.
- Restructured the Settings page with tabbed sections (Automation, Security, System), scheduler "Run Now" and "Reset to defaults" buttons, and next-check countdown display.
- Upgraded the Logs page with color-coded log levels, per-entry copy buttons, export-to-file, improved tab bar filtering, and auto-scroll toggle.
- Improved the Installed page with search/filter, sort options, ExpiryBadge components, bulk "Refresh Expiring" action, and collapsible App ID management.
- Replaced raw search inputs on Sources and IPAs pages with the new SearchInput component.
- Added ExpiryBadge to Apple Account certificate display for visual consistency.

### Added

- Added a comprehensive CSS design system extension with 10 new component classes: skeleton loading, progress bars, search inputs, tooltips, badges, small/icon buttons, dividers, expiry urgency states, drag-and-drop zones, and pipeline steppers.
- Added a consolidated `Icons.tsx` component library with 30 reusable SVG icon components organized by category.
- Added 7 new shared UI components: `SearchInput` (debounced with clear button), `PipelineStepper` (horizontal pipeline visualization), `ExpiryBadge` (color-coded countdown), `DropZone` (drag-and-drop file zone), `Collapsible` (expandable sections), `TabBar` (accessible tab switching), and improved `ProgressBar`.
- Added error handling to Devices page reload that was previously silent on failure.
- Added iOS helper `Haptics` utility with impact, notification, and selection feedback.
- Added iOS helper `PulsingLoadingView` custom animated loading indicator.
- Added iOS helper `EmptyStateView` reusable component with icon, title, description, and action button.
- Added iOS helper semantic status color extensions (success, warning, error, info).
- Added iOS helper improved card styling with gradient backgrounds and dual-shadow depth.

### Fixed

- Fixed pre-existing `trustedPhoneNumbers` missing parameter bug in iOS helper HelperViewModel that was blocking builds.
- Fixed iOS helper SidelinkHelperApp.swift truncation that caused build failures.
- Fixed LogsPage tab bar using non-existent CSS classes (`sl-tab`, `sl-tab-active`) instead of proper `data-active` attributes.
- Fixed DashboardPage passing unused `emphasis` and `editing` props to OverviewStatCard.
- Rebuilt and exported latest iOS helper IPA with all DesignSystem improvements.

## [0.3.1] - 2026-03-09

### Changed

- Promoted manual helper pairing codes to the primary pairing path across the iPhone helper and desktop overview, with QR kept as a secondary fallback instead of competing with the default flow.
- Reworked the iPhone helper onboarding, settings, and pairing surfaces so permissions, readiness, and next actions read like one polished native flow rather than separate utility screens.
- Expanded the iPhone helper Installed tab into a fuller management surface with quota pressure, App ID consumer visibility, unmanaged app discovery, and per-app refresh state instead of a narrow installed-app list.

### Added

- Added a centralized iPhone permission coordinator that requests notifications, camera, local network, and background-refresh access up front and keeps status-aware action buttons in sync after changes.
- Added stronger helper status tiles and pairing cards shared across onboarding and settings so the helper exposes pairing health and permission state more clearly.
- Added release-note and operator-doc updates for the `v0.3.1` release path so current commands and release messaging match the shipped product surface.
- Added a much fuller docs site for setup, desktop usage, helper usage, source downloads, troubleshooting, and release operations instead of leaving critical details scattered across a few thin pages.
- Added the first public non-helper IPA listing to the official SideLink source feed with Cortex metadata and release-backed download URLs.

### Fixed

- Fixed multiple iPhone helper regressions uncovered by real simulator builds, including the onboarding closure break, Installed-tab compiler pressure, missing project-file inclusion for the new permissions source, and refresh-state loading issues in the helper view model.
- Fixed helper-side refresh visibility so App ID quota state, hidden consumers, and auto-refresh status load together during full refresh instead of partially updating or disappearing after pairing changes.

## [0.3.0] - 2026-03-08

### Changed

- Promoted SideLink into a `v0.3.0` release with a stronger release story across desktop, web, docs, and the iPhone helper instead of treating the current state as a string of patch-only packaging fixes.
- Reworked the desktop onboarding surface so the setup flow reads as one product surface, with less chrome, clearer outcomes, and less visual crowding during first launch.
- Refined the iPhone helper Installed tab to reduce refresh-control noise and keep the managed-install surface calmer during background activity.
- Expanded the root README into a fuller product and operator guide with clearer positioning, workflows, release expectations, and validation paths.

### Added

- Added immediate install-console handoff for helper IPA imports from Files and remote URLs so imported IPAs now behave like normal installs instead of stopping at library upload.
- Added install-console persistence during install-job 2FA so verification entry is no longer interrupted by accidental dismissal while a job is waiting for Apple verification.
- Added runtime-path detection coverage for locally built bundled Python helpers so pre-release validation catches packaged Apple runtime regressions before publish.
- Added `v0.3.0` release notes and refreshed release examples across the operator docs.

### Fixed

- Fixed the packaged desktop Apple runtime probe so locally built bundled helpers are detected as bundled helpers instead of being invoked like plain Python interpreters.
- Fixed helper import/install behavior on iPhone so importing an IPA from Files or a URL now opens the install console automatically and routes through the same install path as a regular install.
- Fixed install-console dismissal behavior during install-job 2FA so the sheet stays present until the operator explicitly closes it or the install state changes.

## [0.2.6] - 2026-03-08

### Fixed

- Fixed the packaged desktop helper so released macOS builds can generate anisette data, complete Apple sign-in, and execute bundled `pymobiledevice3` device commands instead of failing only after packaging.
- Added the missing packaged Python assets and metadata required by the frozen helper runtime, including anisette package data, Unicorn support, and CLI metadata needed by the bundled device tooling.
- Hardened packaged desktop smoke validation so releases now exercise helper self-checks, anisette generation, bundled `pmd3 usbmux list --usb`, and GSA helper dispatch before a broken DMG can ship.
- Polished the onboarding layout so the main setup flow and the supporting right rail stay aligned on desktop instead of visually drifting apart.

## [0.2.5] - 2026-03-07

### Fixed

- Fixed the packaged Apple authentication path so onboarding and desktop smoke exercise the same helper dispatch boundary instead of diverging between development and packaged builds.
- Completed the onboarding 2FA workflow by returning trusted phone metadata when Apple exposes it and by wiring the SMS trigger path through the backend instead of leaving it as a no-op.
- Ignored generated Python helper build output and helper export artifacts so desktop release work no longer dirties the repository with local build products.

## [0.2.4] - 2026-03-07

### Fixed

- Published the macOS arm64 updater feed assets needed by Electron auto-update so packaged Apple silicon desktop builds can fetch release metadata instead of failing on `latest-mac.yml`.
- Added clearer desktop updater errors when release metadata is missing and prevented Intel macOS builds from offering a broken in-app update path before a separate x64-safe feed exists.

### Added

- Added a desktop factory reset action in Settings that wipes local SideLink state, clears the stored encryption key, and relaunches into a true first-run setup flow.

## [0.2.3] - 2026-03-07

### Fixed

- Restored the executable bit on the bundled Python helper during desktop packaging so released macOS builds can actually run the packaged readiness, Apple auth, and device runtime.
- Bundled Unicorn native runtime assets into the packaged Python helper so macOS release builds no longer fail when anisette and device tooling initialize inside the shipped app.
- Hardened packaged helper self-check handling so warning-prefixed output does not break desktop smoke validation.

## [0.2.2] - 2026-03-07

### Changed

- Redesigned the desktop onboarding surface to match the stronger SideLink control-center visual language.
- Added an overview-level desktop readiness panel so packaged runtime, helper IPA, Apple signing readiness, and device visibility are obvious before users hit dead ends.
- Hardened local desktop packaging so it refuses to build without the bundled Python helper and now smoke-tests that helper inside the packaged app.
- Trimmed GitHub Release publishing to ship only the helper IPA, DMGs, Windows EXEs, and Linux AppImage/DEB artifacts.

## [0.2.1] - 2026-03-07

### Changed

- Renamed displayed product branding from Sidelink to SideLink across desktop, web, helper, docs, and source metadata.
- Centralized logo generation so desktop, web, and iOS helper assets now come from one shared generator pipeline.
- Consolidated the repo documentation surface around the root README and docs site release notes.
- Updated licensing from MIT to Apache-2.0 with a NOTICE file.
- GitHub Releases now publish the helper IPA and official source manifests now target the latest helper asset.

Release notes moved to the docs site so publish notes, docs deployment guidance, and release policy stay in one place.

- Current notes: `docs/release-notes.md`
- Published page: `https://gabrielvuksani.github.io/sidelink/release-notes`
