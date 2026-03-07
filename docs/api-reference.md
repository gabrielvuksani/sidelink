# API Reference

Base URL: `http://localhost:4010/api`

This is the practical HTTP surface, organized by operational use rather than generated-schema noise.

## Overview

- Response envelope: most authenticated JSON APIs return `{ ok: boolean, data?: T, error?: string }`.
- Auth modes:
  - `Public`: no auth required.
  - `Session`: `sidelink_session` cookie (or Bearer token for internal desktop token support).
  - `Helper Token`: `x-sidelink-helper-token` header.
- Validation source of truth: `src/server/utils/validators.ts`.

## Rate Limits

- Auth tier: `20/min` (`/api/auth/*`)
- Apple auth tier: `5/min` (`/api/apple/*`)
- Upload tier: `10/5min` (`/api/ipas/*`)
- General tier: `120/min` (all other authenticated `/api/*` routes)

Rate-limit response headers include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` on `429` responses.

## Public Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Process health, uptime, memory, setup status |
| `POST` | `/system/pair` | Exchange 6-digit pairing code for helper token |
| `GET` | `/sources/self-hosted` | Public self-hosted source manifest |

### `POST /system/pair`

- Auth: `Public`
- Request body:
  - `code: string` (exactly 6 digits)
- Success `200`:
  - `data.token` helper token
  - `data.serverName`, `data.serverVersion`
- Errors:
  - `400` invalid code format
  - `401` code expired/invalid

## Auth Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `GET` | `/auth/status` | Public | none |
| `POST` | `/auth/setup` | Public | `{ username, password }` |
| `POST` | `/auth/login` | Public | `{ username, password }` |
| `POST` | `/auth/logout` | Session | none |
| `POST` | `/auth/password` | Session | `{ currentPassword, newPassword }` |

Notes:
- `setup` and `login` set `sidelink_session` cookie.
- `password` clears session cookie on success.

## Apple Account Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `POST` | `/apple/signin` | Session | `{ appleId, password }` |
| `POST` | `/apple/2fa` | Session | `{ appleId, password, code, method? }` |
| `POST` | `/apple/2fa/sms` | Session | `{ appleId, phoneNumberId }` |
| `GET` | `/apple/accounts` | Session | none |
| `GET` | `/apple/accounts/:id` | Session | none |
| `POST` | `/apple/accounts/:id/reauth` | Session | none |
| `POST` | `/apple/accounts/:id/reauth/2fa` | Session | `{ code }` |
| `DELETE` | `/apple/accounts/:id` | Session | none |

Notes:
- `signin` and `reauth` may return `requires2FA: true` with `authType`.

## Device Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `GET` | `/devices` | Session | none |
| `POST` | `/devices/refresh` | Session | none |
| `POST` | `/devices/:udid/pair` | Session | none |

## IPA Library Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `POST` | `/ipas/upload` | Session | multipart form (`ipa` file) |
| `GET` | `/ipas` | Session | none |
| `GET` | `/ipas/:id` | Session | none |
| `DELETE` | `/ipas/:id` | Session | none |
| `POST` | `/ipas/import-url` | Session | `{ url }` |

Validation highlights:
- Only `.ipa` extension accepted for uploads.
- Upload size capped by server limits.
- `import-url` supports `http/https` only.

## Install Pipeline Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `POST` | `/install` | Session | `{ accountId, ipaId, deviceUdid, includeExtensions? }` |
| `GET` | `/install/jobs` | Session | query filters: `accountId`, `deviceUdid`, `status` |
| `GET` | `/install/jobs/:id` | Session | none |
| `GET` | `/install/jobs/:id/logs` | Session | none |
| `POST` | `/install/jobs/:id/2fa` | Session | `{ code }` |
| `GET` | `/install/apps` | Session | optional query: `deviceUdid` |
| `DELETE` | `/install/apps/:id` | Session | none |

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
| `GET` | `/sources/self-hosted` | Public + Session | none |
| `PUT` | `/sources/self-hosted` | Session | full manifest payload |

## System Endpoints

| Method | Path | Auth | Request Body |
| --- | --- | --- | --- |
| `GET` | `/system/dashboard` | Session | none |
| `GET` | `/system/logs` | Session | query: `limit`, `level` |
| `DELETE` | `/system/logs` | Session | none |
| `GET` | `/system/scheduler` | Session | none |
| `POST` | `/system/scheduler` | Session | `{ enabled?, checkIntervalMs? }` |
| `POST` | `/system/scheduler/refresh/:id` | Session | none |
| `GET` | `/system/scheduler/states` | Session | none |
| `GET` | `/system/auto-refresh-states` | Session | none |
| `GET` | `/system/helper/doctor` | Session | none |
| `POST` | `/system/helper/pairing-code` | Session | none |
| `POST` | `/system/helper/ensure` | Session | optional `{ teamId }` |
| `POST` | `/system/helper/ensure-ipa` | Session | optional `{ teamId }` |

## Events (Session)

| Method | Path | Auth | Type |
| --- | --- | --- | --- |
| `GET` | `/events` | Session | Server-Sent Events |

Event stream includes live job/device/system updates and keep-alive frames.

## Helper API Endpoints (Companion App)

All `/helper/*` routes require helper token auth via `x-sidelink-helper-token`.

| Method | Path | Request Body |
| --- | --- | --- |
| `GET` | `/helper/status` | query `deviceId?` |
| `GET` | `/helper/config` | none |
| `GET` | `/helper/auto-refresh-states` | none |
| `GET` | `/helper/accounts` | none |
| `GET` | `/helper/devices` | none |
| `GET` | `/helper/ipas` | none |
| `POST` | `/helper/ipas/import-url` | `{ url }` |
| `POST` | `/helper/install` | `{ ipaId, accountId, deviceUdid, includeExtensions? }` |
| `GET` | `/helper/jobs` | none |
| `GET` | `/helper/jobs/:id` | none |
| `GET` | `/helper/jobs/:id/logs` | none |
| `POST` | `/helper/jobs/:id/2fa` | `{ code }` |
| `GET` | `/helper/apps` | query `deviceUdid?` |
| `DELETE` | `/helper/apps/:id` | none |
| `POST` | `/helper/refresh` | `{ installId }` |
| `GET` | `/helper/doctor` | none |
| `GET` | `/helper/events` | SSE |

## Error Semantics

Common status codes:

- `400` validation error or malformed input
- `401` authentication required/invalid credentials/token
- `403` pre-setup or forbidden operation
- `404` missing resource
- `409` state conflict (e.g., job not awaiting 2FA)
- `413` upload size exceeded
- `429` rate-limited
- `500` unexpected server failure

Most non-2xx responses include `{ ok: false, error: string }`.

## Operator Notes

- `/auth/setup` is only meant for first-run bootstrap before the first admin exists
- helper-token routes are intentionally narrower than dashboard session routes
- install and refresh behavior is modeled around explicit state transitions, retries, and recovery steps
