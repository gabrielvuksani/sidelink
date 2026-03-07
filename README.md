<p align="center">
	<img src="src/client/public/brandmark.svg" alt="SideLink logo" width="96" height="96">
</p>

<h1 align="center">SideLink</h1>

<p align="center">
	Local-first iOS sideloading with a desktop control center, a TypeScript signing pipeline, and an iPhone helper that feels like part of the product instead of an afterthought.
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

## Why SideLink

Most sideloading stacks feel like a pile of unrelated tools: one thing for signing, another for device state, another for sources, and a phone companion that barely knows what the desktop app is doing.

SideLink is built as one system:

- a React control center for installs, devices, Apple IDs, sources, logs, and scheduling
- an Electron desktop shell with tray controls, packaging, and updater plumbing
- a pure TypeScript signing pipeline with explicit job state and live progress
- an iPhone helper that can pair, browse feeds, install apps, submit 2FA, and monitor refresh health
- AltStore-compatible source support with a shipped official feed and release-hosted helper IPA

## Product Surface

| Surface | What it handles |
| --- | --- |
| Desktop + Web | accounts, devices, installs, IPA library, logs, scheduler state, source management, helper controls |
| Signing backend | provisioning, resigning, install orchestration, retries, 2FA pause/resume, refresh lifecycle |
| iPhone helper | pairing, source browsing, installs, refresh visibility, Apple account follow-up, diagnostics |
| Docs + releases | packaged desktop artifacts, published docs site, official source feed, helper IPA distribution |

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

### Launch the desktop app

```bash
npm run desktop:easy
```

On first launch, SideLink prompts you to create the local admin account. There is no seeded default username or password.

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

`npm run verify` runs TypeScript checks, tests, production builds, docs build, and runtime diagnostics.

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

If you want to build the helper locally:

```bash
npm run helper:build
npm run helper:export
```

Expected exported IPA path:

```text
tmp/helper/SidelinkHelper.ipa
```

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
bash scripts/release.sh v0.2.0 --dry-run
```

The release flow expects a helper IPA to exist first. On macOS, generate it with:

```bash
npm run helper:export
```

The release script will copy `tmp/helper/SidelinkHelper.ipa` into `helper/SidelinkHelper.ipa`, stage it, and publish that tracked asset with the tagged release.

Then create the real release:

```bash
bash scripts/release.sh v0.2.0
git push origin main --tags
```

Published semver tags are treated as immutable release records.

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
