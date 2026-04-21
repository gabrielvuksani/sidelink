# API Reference

Base URL: `http://localhost:4010/api`

This is the practical HTTP surface, organised by operational use rather than generated-schema noise. Every currently-registered route is listed — if you find a route in the codebase that isn't here, that's a documentation bug.

## Overview

- Response envelope: authenticated JSON APIs return `{ ok: boolean, data?: T, error?: string }`.
- Auth modes:
  - `Public`: no auth required.
  - `Session`: `sidelink_session` cookie (or `Authorization: Bearer <internalToken>` for the trusted in-process Electron caller).
  - `Helper Token`: `x-sidelink-helper-token` header. Tokens are SHA-256 hashed at rest; the server never stores the plaintext after the pairing exchange.
- CSRF: cookie-authenticated routes under `/api` require an `x-sidelink-csrf` header matching the `sidelink_csrf` cookie. The auth / pair / SSE / helper routes are exempt.
- Validation source of truth: `src/server/utils/validators.ts`.

## Rate Limits

- Auth tier: `20/min` (`/api/auth/*`)
- Apple auth tier: `5/min` (`/api/apple/*` + helper equivalents)
- Upload tier: `10/5min` (`/api/ipas/*` + `/helper/ipas/*`)
- General tier: `240/min` (all other authenticated `/api/*` routes)
- Pair-code tier: `10/min` (`POST /api/system/pair`)

Rate-limit response headers include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` on `429`.

Notes:

- `GET /api/events` and `GET /api/helper/events` are authenticated but don't share the general burst bucket so SSE doesn't starve polling clients.

## Public Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Process health, uptime, memory, setup status |
| `POST` | `/system/pair` | Exchange 6-digit pairing code for helper token |
| `GET` | `/sources/self-hosted` | Public self-hosted source manifest |

### `POST /system/pair`

- Auth: `Public` (rate-limited)
- Request body:
  - `code: string` (exactly 6 digits)
- Success `200`:
  - `data.token` helper token (plaintext, returned once)
  - `data.serverName`, `data.serverVersion`, `data.backendUrl`, `data.candidateAddresses`
- Errors:
  - `400` invalid code format
  - `401` code expired or already consumed

## Auth Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `GET` | `/auth/status` | Public | none |
| `POST` | `/auth/setup` | Public | `{ username, password }` |
| `POST` | `/auth/login` | Public | `{ username, password }` |
| `POST` | `/auth/logout` | Session | none |
| `POST` | `/auth/password` | Session | `{ currentPassword, newPassword }` |
| `POST` | `/auth/reset` | Session (admin) | none |

Notes:
- `setup` returns `409` when an admin already exists — a concurrent setup-wizard tab cannot crash the server.
- `setup` and `login` set the `sidelink_session` cookie and mint a `sidelink_csrf` token.
- `password` clears the session cookie on success, invalidating all sessions for the user.
- `reset` wipes all users + sessions, forcing the first-run wizard to re-appear on next load.

## Apple Account Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `POST` | `/apple/signin` | Session | `{ appleId, password }` |
| `POST` | `/apple/2fa` | Session | `{ appleId, password, code, method? }` |
| `POST` | `/apple/2fa/sms` | Session | `{ appleId, phoneNumberId }` |
| `GET` | `/apple/accounts` | Session | none |
| `GET` | `/apple/accounts/:id` | Session | none |
| `POST` | `/apple/accounts/:id/reauth` | Session | `{ password }` |
| `POST` | `/apple/accounts/:id/reauth/2fa` | Session | `{ code }` |
| `DELETE` | `/apple/accounts/:id` | Session | none |
| `POST` | `/apple/accounts/:id/rotate-certificate` | Session | none |
| `GET` | `/apple/app-ids` | Session | optional query: `sync=1` |
| `GET` | `/apple/app-ids/usage` | Session | none |
| `DELETE` | `/apple/app-ids/:id` | Session | none |
| `GET` | `/apple/certificates` | Session | none |

Notes:
- `signin` and `reauth` may return `{ requires2FA: true, authType, twoFAChallenge }` on a 2FA-required Apple ID.
- `app-ids?sync=1` forces a round-trip to Apple's dev portal; omitting the flag returns the locally cached set.

## Device Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `GET` | `/devices` | Session | none |
| `POST` | `/devices/refresh` | Session | none |
| `POST` | `/devices/:udid/pair` | Session | none |
| `GET` | `/devices/:udid/capabilities` | Session | none |

Notes:
- `/capabilities` returns `{ hasLiveContainer, liveContainerBundleId, totalAppsInstalled }` used by the install modal to surface upgrade paths.

## IPA Library Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `POST` | `/ipas/upload` | Session | multipart form (`ipa` file) |
| `GET` | `/ipas` | Session | none |
| `GET` | `/ipas/:id` | Session | none |
| `DELETE` | `/ipas/:id` | Session | none |
| `POST` | `/ipas/import-url` | Session | `{ url, downloadSize? }` |
| `POST` | `/ipas/import-path` | Session (internal token only) | `{ path }` |

Validation highlights:
- Only `.ipa` extension accepted for uploads.
- Upload size cap: 500 MB (enforced at multer + stream level).
- `import-url` enforces https (http permitted only for RFC1918 / loopback hosts) and applies the source-fetch SSRF guard: hostnames are resolved and any private IP result is rejected.
- `import-path` is intentionally restricted to the internal token used by Electron's open-file handler so dashboard users can't point the server at arbitrary local filesystem paths.

## Install Pipeline Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `POST` | `/install` | Session | see body schema below |
| `GET` | `/install/jobs` | Session | query filters: `accountId`, `deviceUdid`, `status` |
| `GET` | `/install/jobs/:id` | Session | none |
| `GET` | `/install/jobs/:id/logs` | Session | none |
| `POST` | `/install/jobs/:id/cancel` | Session | none |
| `POST` | `/install/jobs/:id/2fa` | Session | `{ code }` |
| `GET` | `/install/apps` | Session | optional query: `deviceUdid` |
| `GET` | `/install/apps/updates` | Session | none |
| `DELETE` | `/install/apps/:id` | Session | optional query: `force=1` |
| `POST` | `/install/apps/:id/deactivate` | Session | none |
| `POST` | `/install/apps/:id/reactivate` | Session | none |

### `POST /install` body schema

| Field | Type | Notes |
| --- | --- | --- |
| `accountId` | string | Apple account id to sign with |
| `ipaId` | string | IPA artifact id from `/ipas` |
| `deviceUdid` | string | Target device UDID |
| `includeExtensions` | boolean (optional) | Sign bundled `.appex` plug-ins too |
| `bundleIdStrategy` | `"deterministic"` or `"randomized"` (optional) | Default `"randomized"`. `"deterministic"` preserves the IPA's original bundle id — use only when you own the ID on the Apple Developer portal. `"randomized"` rewrites the bundle id to a unique SideLink-scoped value so multiple installs of the same IPA coexist on one device and collisions with dev-portal App IDs are avoided. |
| `customDisplayName` | string (optional) | Rewrites `CFBundleDisplayName` on the signed output so duplicate installs are distinguishable on the home screen. |

Notes:
- `DELETE /install/apps/:id` performs a best-effort on-device uninstall and removes the signed IPA artifact before deleting the DB row. `force=1` skips the device uninstall (use when the device is permanently gone).
- `GET /install/apps/updates` consults the combined source manifest and returns entries whose `version` is strictly greater than the installed version under semver-aware comparison (so `"1.10.0" > "1.9.0"` as expected).

## Source Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `GET` | `/sources` | Session | none |
| `POST` | `/sources` | Session | `{ url }` |
| `POST` | `/sources/:id/refresh` | Session | none |
| `DELETE` | `/sources/:id` | Session | none |
| `GET` | `/sources/:id/apps` | Session | none |
| `GET` | `/sources/:id/manifest` | Session | none |
| `GET` | `/sources/combined` | Session | none |
| `GET` | `/sources/community` | Session | none |
| `GET` | `/sources/self-hosted` | Public + Session | none |
| `PUT` | `/sources/self-hosted` | Session | full manifest payload |
| `GET` | `/sources/trusted-sources` | Session | none |

Source manifest fetches use https-only validation: http is rejected unless the hostname is loopback or RFC1918, and DNS resolution is performed before fetch so an https hostname cannot resolve to a private IP (rebinding / split-horizon DNS).

When aggregated into the combined source, duplicate `bundleIdentifier` entries are reduced to the highest semver rather than first-wins, so a later-ordered source shipping a newer version doesn't get masked by an older first entry.

## System Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `GET` | `/system/dashboard` | Session | none |
| `GET` | `/system/logs` | Session | query: `limit`, `level` |
| `DELETE` | `/system/logs` | Session | none |
| `GET` | `/system/scheduler` | Session | none |
| `POST` | `/system/scheduler` | Session | `{ enabled?, checkIntervalMs?, refreshThresholdMs? }` |
| `POST` | `/system/scheduler/refresh/:id` | Session | none |
| `POST` | `/system/scheduler/refresh-all` | Session | none |
| `GET` | `/system/scheduler/states` | Session | none |
| `GET` | `/system/auto-refresh-states` | Session | none |
| `GET` | `/system/webhook` | Session | none |
| `PUT` | `/system/webhook` | Session | `{ url }` (empty string unsets) |
| `GET` | `/system/helper/doctor` | Session | none |
| `POST` | `/system/helper/pairing-code` | Session | none |
| `POST` | `/system/helper/ensure` | Session | optional `{ teamId }` |
| `POST` | `/system/helper/ensure-ipa` | Session | optional `{ teamId }` |

Notes:
- `PUT /system/webhook` rejects non-http(s) URLs, URLs with userinfo, and any hostname that resolves to a private / loopback IP. A defence-in-depth revalidation runs again at `fireWebhook` call time so a bypass via manual DB edit cannot cause the scheduler to call into the LAN.
- `POST /system/scheduler/refresh-all` triggers auto-refresh across every active install; the response includes `{ triggered, skipped, errors[] }`.

## Events (Session)

| Method | Path | Auth | Type |
| --- | --- | --- | --- |
| `GET` | `/events` | Session | Server-Sent Events |

Event types:

- `job-update` — any install / refresh job state transition
- `job-log` — a new log line appended to a job
- `device-update` — device connect/disconnect/trust status
- `app-update` — installed-app list changed
- `scheduler-update` — scheduler snapshot changed (timer, last error, pending count)
- `log` — system log event (debug/info/warn/error)

## Helper API Endpoints (Companion App)

All `/helper/*` routes require helper token auth via `x-sidelink-helper-token`. The server stores only `SHA-256(token)` in the DB; the plaintext is returned exactly once from `POST /system/pair`.

| Method | Path | Request Body / Notes |
| --- | --- | --- |
| `GET` | `/helper/status` | query `deviceId?` |
| `GET` | `/helper/config` | none |
| `GET` | `/helper/auto-refresh-states` | none |
| `GET` | `/helper/accounts` | none |
| `POST` | `/helper/apple/signin` | `{ appleId, password }` |
| `POST` | `/helper/apple/2fa` | `{ appleId, password, code, method? }` |
| `POST` | `/helper/apple/2fa/sms` | `{ appleId, phoneNumberId }` |
| `POST` | `/helper/apple/accounts/:id/reauth` | `{ password? }` |
| `POST` | `/helper/apple/accounts/:id/reauth/2fa` | `{ code }` |
| `DELETE` | `/helper/apple/accounts/:id` | none |
| `GET` | `/helper/devices` | none |
| `GET` | `/helper/ipas` | none |
| `GET` | `/helper/jobs` | none |
| `GET` | `/helper/jobs/:id` | none |
| `GET` | `/helper/jobs/:id/logs` | none |
| `GET` | `/helper/apps` | query `deviceUdid?` |
| `POST` | `/helper/apps/:id/deactivate` | none |
| `POST` | `/helper/apps/:id/reactivate` | none |
| `DELETE` | `/helper/apps/:id` | optional `force=1` |
| `POST` | `/helper/jobs/:id/cancel` | none |
| `POST` | `/helper/jobs/:id/2fa` | `{ code }` |
| `POST` | `/helper/ipas/import-url` | `{ url }` |
| `POST` | `/helper/ipas/upload` | multipart form (`ipa` file) |
| `POST` | `/helper/install` | same body schema as `POST /install` |
| `POST` | `/helper/refresh` | `{ installId }` |
| `POST` | `/helper/refresh-all` | none |
| `GET` | `/helper/logs` | query `limit`, `level` |
| `GET` | `/helper/app-ids` | optional `sync=1` |
| `GET` | `/helper/app-ids/usage` | none |
| `DELETE` | `/helper/app-ids/:id` | none |
| `GET` | `/helper/certificates` | none |
| `GET` | `/helper/trusted-sources` | none |
| `GET` | `/helper/devices/:udid/all-apps` | Lists managed + unmanaged bundle ids on the device |
| `GET` | `/helper/doctor` | none |
| `GET` | `/helper/sources` | none |
| `POST` | `/helper/sources` | `{ url }` |
| `POST` | `/helper/sources/:id/refresh` | none |
| `DELETE` | `/helper/sources/:id` | none |
| `GET` | `/helper/events` | SSE (mirrors desktop event types) |

## Error Semantics

| Status | Meaning |
| --- | --- |
| `400` | Validation error or malformed input |
| `401` | Authentication required / invalid credentials or token |
| `403` | Pre-setup or forbidden operation |
| `404` | Missing resource |
| `409` | State conflict (e.g. job not awaiting 2FA, admin already exists) |
| `413` | Upload size exceeded |
| `429` | Rate-limited |
| `500` | Unexpected server failure |

Non-2xx responses include `{ ok: false, error: string }`. On validation errors the message is deterministically generated from the failing field.

## Operator Notes

- `/auth/setup` is only meant for first-run bootstrap before the first admin exists. It returns `409` (not `401`) if an admin is already set up — this is a state conflict, not an authentication failure.
- Helper-token routes are intentionally narrower than dashboard session routes: some sensitive flows (rotate-certificate, password change, admin reset) are session-only.
- Install and refresh behaviour is modelled around explicit state transitions (queued → running → waiting_2fa → running → completed | failed | cancelled). The `2fa` submit path is always a `POST /.../jobs/:id/2fa` — there is no side-channel for code entry.
- The internal token used by the Electron main process is never written to `process.env`; it is passed as an explicit `internalToken` option to `createApp(ctx, { internalToken })` at boot so spawned child processes can't read it.
