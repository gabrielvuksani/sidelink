# Sidelink

Sidelink is a cross-platform personal iOS sideload manager built around one idea: sideloading should feel like operating a real product, not juggling disconnected scripts, half-working dashboards, and fragile refresh workflows.

It combines a TypeScript signing backend, a browser-based control center, an Electron desktop shell, AltStore-compatible source support, and an optional iPhone companion app that can pair to the helper, browse sources, monitor installs, and manage refresh state directly on-device.

## What Sidelink Includes

- Web control center for accounts, devices, installs, sources, logs, scheduler state, and IPA management
- Electron desktop app with tray integration, desktop packaging, auto-update plumbing, and helper controls
- Pure TypeScript backend and signing pipeline with install job tracking, live logs, and 2FA-aware recovery
- Optional iPhone helper app for pairing, browsing sources, monitoring installs, reviewing signing state, and background refresh controls
- AltStore-compatible source ingestion plus trusted-source curation
- Release and docs pipelines for packaged desktop builds and published documentation

## Why This Repo Exists

Sidelink is not just an AltStore clone with a different skin. The repo is structured to expose more of the actual sideloading system:

- Device, account, and install state are surfaced as first-class data instead of being hidden behind a single “refresh and hope” action
- Install jobs are modeled explicitly, with step-by-step state, logs, retries, and 2FA interruption support
- The iPhone helper is designed as a companion control surface, not just a thin pairing screen
- Desktop and web flows share the same backend and state model, so the product behaves like one system instead of parallel tools

## Current Product Surface

### Web and desktop

- Overview dashboard with consolidated system state
- Apple account management, including re-auth and 2FA handling
- Device inventory and install targeting
- IPA library upload/import flows
- Install queue and job log inspection
- Installed app management, refresh, deactivate/reactivate, and cleanup flows
- Source management and trusted-source browsing
- Scheduler and background refresh configuration
- Helper diagnostics, helper IPA import/build controls, pairing code, and QR pairing surfaces

### iPhone helper

- Pair to the desktop helper using QR or a 6-digit pairing code
- Browse uploaded IPAs and source catalogs
- Install from library or sources with a live install console
- Submit Apple 2FA inline when the pipeline pauses for verification
- Review installed apps, signing slot usage, certificates, logs, App IDs, and sources
- Control background refresh behavior from the phone companion

## Architecture

The repository is organized into a few clear layers:

- `src/server/`: Express server, helper routes, pipeline orchestration, services, scheduler, source ingestion, and signing logic
- `src/client/`: React + Vite web client used both in browser and inside Electron
- `src/desktop/`: Electron main/preload/tray/window integration
- `src/shared/`: shared DTOs, constants, and types used by client and server
- `ios-helper/`: native SwiftUI iPhone helper app and Xcode project
- `docs/`: VitePress documentation site
- `scripts/`: preflight checks, helper build/export utilities, release automation, migrations, and diagnostics
- `tests/`: Vitest coverage for pipeline, signing, validators, routes, and integration behavior

## Quick Start

### Requirements

- Node.js 20+
- Python 3.10+
- macOS 11+ for full local device install support and local iOS helper build/export
- An Apple ID for signing

### Start the web control center

```bash
git clone https://github.com/gabrielvuksani/sidelink.git
cd sidelink
npm install
npm run dev
```

Then open `http://localhost:4010`.

`npm install` runs the dependency preflight and prepares the local Python side of the project automatically.

If you want the full bootstrap and validation pass in one command:

```bash
npm run setup
```

## Common Workflows

### Run the server locally

```bash
npm run dev
```

### Launch the desktop app

Preferred local path:

```bash
npm run desktop:easy
```

Alternative Electron dev launch:

```bash
npm run desktop:dev
```

### Build the project

```bash
npm run build
```

### Validate everything

```bash
npm run verify
```

`verify` runs TypeScript validation, tests, production builds, docs build, and doctor checks.

### Watch tests

```bash
npm run test:watch
```

### Inspect local logs

```bash
npm run logs
```

## iPhone Helper

The iPhone helper is optional, but it is a major part of the product rather than an afterthought.

It lets you:

- pair to the desktop helper from your phone
- browse sources and uploaded IPAs
- follow installs through a dedicated install console
- submit 2FA directly when the pipeline pauses
- inspect logs, App IDs, certificates, and installed apps

Build/export scripts are available for local helper packaging:

```bash
npm run helper:build
npm run helper:export
```

The easiest path in practice is to use the desktop helper controls to one-click build or import the helper IPA when running on macOS.

## Packaging

Desktop packaging commands:

```bash
npm run desktop:package
npm run desktop:package:win
npm run desktop:package:linux
npm run desktop:package:all
```

The desktop app uses Electron Builder and publishes release metadata compatible with in-app update checks.

## Documentation

Project documentation lives in `docs/` and is built with VitePress.

Most useful entry points:

- `docs/getting-started.md`
- `docs/desktop-app.md`
- `docs/ios-helper.md`
- `docs/configuration.md`
- `docs/cli-reference.md`
- `docs/api-reference.md`
- `docs/troubleshooting.md`
- `docs/security.md`

Preview docs locally:

```bash
npm run docs:dev
```

Build docs for production:

```bash
npm run docs:build
```

## Core Commands

```bash
npm run dev
npm run desktop:easy
npm run build
npm run test
npm run verify
npm run doctor
npm run db:migrate
```

## Release Flow

Dry-run the release script first:

```bash
bash scripts/release.sh v0.1.0 --dry-run
```

Then cut a real release:

```bash
bash scripts/release.sh v0.1.0
git push origin main --tags
```

## Repository Notes

- The backend, web client, and desktop app are developed together in this repo
- The iPhone helper is native SwiftUI and ships alongside the core project rather than in a separate repository
- Source support is AltStore-compatible, but the product is intentionally opinionated about visibility, diagnostics, and workflow control

## License

MIT
