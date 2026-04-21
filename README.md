<p align="center">
	<img src="src/client/public/brandmark.svg" alt="SideLink logo" width="96" height="96">
</p>

<h1 align="center">SideLink</h1>

<p align="center">
	Local-first iOS sideloading with a release-ready desktop control center, a TypeScript signing pipeline, a packaged Apple runtime, and an iPhone helper that behaves like part of one system.
</p>

<p align="center">
	<a href="https://gabrielvuksani.github.io/sidelink/">Docs</a>
	·
	<a href="https://github.com/gabrielvuksani/sidelink/releases">Releases</a>
	·
	<a href="https://gabrielvuksani.github.io/sidelink/getting-started">Getting Started</a>
	·
	<a href="https://gabrielvuksani.github.io/sidelink/ios-helper">iOS Helper</a>
</p>

<p align="center">
	<strong>v0.8.0</strong> turns helper pairing and on-device management into a first-class product surface: code-first pairing across desktop and iPhone, up-front permissions with live status, a fuller Installed tab, and a cleaner native helper UI throughout.
</p>

## Why SideLink

Most sideloading stacks feel like a pile of unrelated tools: one thing for signing, another for device state, another for sources, and a phone companion that barely knows what the desktop app is doing.

SideLink is built as one system:

- a React control center for installs, devices, Apple IDs, sources, logs, and scheduling
- an Electron desktop shell with tray controls, packaging, and updater plumbing
- a pure TypeScript signing pipeline with explicit job state and live progress
- an iPhone helper that can pair, browse feeds, install apps, submit 2FA, and monitor refresh health
- AltStore-compatible source support with a shipped official feed and release-hosted helper IPA

## What v0.8.0 Delivers

- A code-first helper pairing flow across desktop and iPhone, with QR still available as a fallback instead of the primary path.
- Up-front helper permission requests with live readiness state for notifications, camera, local network, and background refresh.
- A more capable iPhone Installed tab that exposes App ID quota pressure, hidden consumers, unmanaged apps, and per-app refresh state.
- Stronger helper onboarding, pairing, and settings screens that share one polished status-card language instead of feeling like disconnected utilities.
- A release and operator story updated for `v0.8.0` across the README, changelog, release notes, and command examples.

## Why It Feels Different

SideLink is not trying to be a grab bag of scripts with a UI wrapped around them. It is one release surface with four coordinated layers:

- Desktop and web give you the control center.
- The backend owns signing, source ingestion, install orchestration, and recovery.
- The packaged Apple runtime keeps auth and device tooling consistent between development and downloaded builds.
- The iPhone helper gives installs, pairing, refresh state, and Apple verification a native on-device surface.

## Product Surface

| Surface | What it handles |
| --- | --- |
| Desktop + Web | accounts, devices, installs, IPA library, logs, scheduler state, source management, helper controls |
| Signing backend | provisioning, resigning, install orchestration, retries, 2FA pause/resume, refresh lifecycle |
| Packaged Apple runtime | anisette generation, GSA auth dispatch, bundled `pymobiledevice3`, packaged desktop diagnostics |
| iPhone helper | pairing, source browsing, installs, import-and-install flows, refresh visibility, Apple account follow-up, diagnostics |
| Docs + releases | packaged desktop artifacts, published docs site, official source feed, helper IPA distribution, release playbooks |

## Feature Snapshot

| Capability | Included in SideLink |
| --- | --- |
| Local admin bootstrap | first-run account creation, no seeded default login |
| Desktop control center | onboarding, installs, sources, logs, accounts, devices, release-safe packaging |
| Web control center | same backend surface for browser-based local operation |
| iPhone helper | pairing, browsing, install console, 2FA entry, import from Files or URL |
| Release packaging | macOS, Windows, and Linux packaging commands with smoke validation |
| Official source feed | generated from `docs/source/apps/` with helper IPA distribution |
| Docs site | published operator docs for setup, release, troubleshooting, security, and architecture |

## Quick Start

### Requirements

- Node.js 20+
- Python 3.10+
- macOS 11+ for full local device install support and local helper build/export
- An Apple ID for signing

### Run locally

```bash
git clone https://github.com/gabrielvuksani/sidelink.git
cd sidelink
npm install
npm run dev
```

Then open `http://localhost:4010`.

For the full bootstrap and validation path:

```bash
npm run setup
```

## Official Source

If you want SideLink-managed app downloads without manually importing every IPA, add the official source feed:

```text
https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source/source.json
```

Current public source apps include:

- `SidelinkHelper.ipa`
- `Cortex.ipa`

Direct latest-release asset links:

- `https://github.com/gabrielvuksani/sidelink/releases/latest/download/SidelinkHelper.ipa`
- `https://github.com/gabrielvuksani/sidelink/releases/latest/download/Cortex.ipa`

### Launch the desktop app

```bash
npm run desktop:easy
```

On first launch, SideLink prompts you to create the local admin account. There is no seeded default username or password.

## First Product Loop

If you want the shortest path from clone to a real install flow, use this sequence:

1. Launch the server or desktop app.
2. Create the local admin account.
3. Pair the iPhone helper or connect the target device.
4. Add and verify an Apple ID.
5. Import an IPA or add a source.
6. Start the install and watch the install console carry signing, provisioning, and 2FA through completion.

## Operator Workflow

### Local development

- `npm run dev` for server-only development.
- `npm run desktop:easy` for the fastest real product loop.
- `npm run desktop:dev` when you want a full Electron build plus preflight.
- `npm run logs` to tail desktop logs from the local data directory.
- `npm run source:watch` when you are iterating on the official source feed.

## Core Workflows

### Development

```bash
npm run dev
npm run desktop:dev
npm run test:watch
npm run logs
```

### Validation

```bash
npm run build
npm run verify
npm run doctor
```

`npm run verify` runs TypeScript checks, tests, production builds, docs build, source regeneration, and runtime diagnostics.

For the current release path on macOS, the most useful pre-publish sequence is:

```bash
npm run verify
npm run python:bundle
npm run desktop:package
npm run desktop:smoke
```

That sequence validates both the source build and the packaged desktop release surface.

### Official Source Drop Zone

```bash
npm run source:watch
```

Then drop release IPAs into `docs/source/apps/`. The official source manifest regenerates automatically, and `npm run verify` also refreshes it before release validation.

### Packaging

```bash
npm run desktop:package
npm run desktop:package:win
npm run desktop:package:linux
npm run desktop:package:all
```

## iPhone Helper

The helper is not a side project in a subfolder. It is part of the release surface.

- GitHub Releases now ship `SidelinkHelper.ipa` directly
- desktop packaging can bundle a local or committed helper IPA automatically
- the official source feed points at the latest published helper IPA asset
- the iPhone helper can import a local IPA or a remote IPA URL and continue directly into the install console
- install-job 2FA now stays inside the same install console instead of forcing users to recover lost install context

If you want to build the helper locally:

```bash
npm run helper:build
npm run helper:export
```

Expected exported IPA path:

```text
tmp/helper/SidelinkHelper.ipa
```

### iPhone helper workflow

The helper now supports a fuller native loop:

- pair to the running SideLink backend
- browse sources and installed apps on device
- import IPA files from Files
- import IPA URLs directly
- open the live install console automatically after import
- enter install-job 2FA without losing the console
- track refresh and expiry state for managed apps

## Branding

The logo now has one canonical source: `scripts/generate-icon-assets.py`.

That one generator produces:

- desktop icons in `build/icons/`
- the web brand asset in `src/client/public/brandmark.svg`
- iOS app icons in `AppIcon.appiconset`
- the reusable iOS in-app brand asset in `BrandMark.imageset`

If you want to change the brand mark in the future, update the generator and run:

```bash
npm run icon:generate
```

## Docs

Project documentation lives in `docs/` and publishes to:

- `https://gabrielvuksani.github.io/sidelink/`

Useful entry points:

- `docs/getting-started.md`
- `docs/desktop-app.md`
- `docs/ios-helper.md`
- `docs/release-notes.md`
- `docs/configuration.md`
- `docs/cli-reference.md`
- `docs/api-reference.md`
- `docs/troubleshooting.md`
- `docs/security.md`

Local docs commands:

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

## Release Flow

Dry-run the release script first:

```bash
bash scripts/release.sh v0.8.0 --dry-run
```

The release flow expects a helper IPA to exist first. On macOS, generate it with:

```bash
npm run helper:export
```

The release script will copy `tmp/helper/SidelinkHelper.ipa` into `helper/SidelinkHelper.ipa`, stage it, and publish that tracked asset with the tagged release.

Then create the real release:

```bash
bash scripts/release.sh v0.8.0
git push origin main --tags
```

Published semver tags are treated as immutable release records.

### Recommended release sequence

1. Run `npm run verify`.
2. On macOS, run `npm run helper:export` if the helper IPA needs to be refreshed.
3. Run `npm run desktop:package`.
4. Run `npm run desktop:smoke`.
5. Run `bash scripts/release.sh v0.8.0`.
6. Push `main` and tags so GitHub Actions can publish artifacts and docs.

## Release Notes Summary

The `v0.8.0` release is the point where the helper stops feeling like a secondary companion and starts behaving like a deliberate part of the product surface:

- manual pairing codes are the primary path on both desktop and iPhone
- permission state is visible and actionable from the first helper launch
- Installed on iPhone exposes quota, refresh, and unmanaged-app context instead of hiding it
- helper pairing and settings surfaces use a clearer native status language
- the current release docs and commands match the shipped `v0.8.0` surface

## Repository Layout

- `src/server/` Express API, services, scheduler, sources, and signing
- `src/client/` React + Vite control center
- `src/desktop/` Electron shell, tray, menu, updater, preload
- `src/shared/` shared DTOs and constants
- `ios-helper/` native SwiftUI helper app
- `docs/` VitePress site and official source feed
- `scripts/` release, helper, migration, asset, and preflight tooling
- `tests/` Vitest coverage for pipeline, security, signing, and integration paths

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
