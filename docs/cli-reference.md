# CLI Reference

## Development

| Command | Description |
|---|---|
| `npm run setup` | Install dependencies and run the full verification suite |
| `npm run dev` | Start server in watch mode |
| `npm run web` | Start server once |
| `npm run desktop:easy` | One-command desktop launch |
| `npm run desktop:dev` | Build + preflight + Electron |

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
| `bash scripts/release.sh v0.1.0` | Update package version, create the release commit, and tag `v0.1.0` |
