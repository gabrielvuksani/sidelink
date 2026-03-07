# CLI Reference

This page is the practical command surface for local development, release prep, and recovery operations.

## Development

| Command | Description |
|---|---|
| `npm run setup` | Install dependencies and run the full verification suite |
| `npm run dev` | Start server in watch mode |
| `npm run web` | Start server once |
| `npm run desktop:easy` | One-command desktop launch |
| `npm run desktop:dev` | Build + preflight + Electron |
| `npm run desktop:smoke` | Launch packaged desktop build in smoke-test mode |

## Quality

| Command | Description |
|---|---|
| `npm run verify` | Run lint, tests, build, docs build, and doctor |
| `npm run lint` | Type-check project |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run build` | Full production build |
| `npm run doctor` | Check the active runtime/toolchain state |

## Database

| Command | Description |
|---|---|
| `npm run db:migrate` | Apply DB migrations |
| `npm run db:bootstrap` | Bootstrap admin user |
| `npm run reset` | Clear local dev database and uploads |
| `npm run reset:fresh` | Wipe local state, sessions, uploads, and stored keychain master key |

## iOS Helper

| Command | Description |
|---|---|
| `npm run helper:build` | Build helper archive |
| `npm run helper:export` | Export helper IPA |
| `npm run icon:generate` | Generate desktop + iOS icons |

## Desktop Packaging

| Command | Description |
|---|---|
| `npm run desktop:package` | macOS directory package |
| `npm run desktop:package:win` | Windows directory package |
| `npm run desktop:package:linux` | Linux directory package |
| `npm run desktop:package:all` | All platform package targets |

## Release

| Command | Description |
|---|---|
| `bash scripts/release.sh v0.1.0 --dry-run` | Validate the release command path without committing or tagging |
| `bash scripts/release.sh v0.2.0 --dry-run` | Validate the release command path without committing or tagging |
| `bash scripts/release.sh v0.2.0` | Update package version, create the release commit, and tag `v0.2.0` |

## Recommended v0.2.0 Release Sequence

1. `npm run verify`
2. `npm run desktop:package`
3. `npm run desktop:smoke`
4. `bash scripts/release.sh v0.2.0`
