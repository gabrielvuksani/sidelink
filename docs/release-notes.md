# Release Notes

This page tracks the user-visible release surface and the release-engineering changes that matter when you publish SideLink.

## v0.2.1

### Highlights

- Renamed the user-facing product brand to SideLink across the desktop app, control center, iPhone helper, and docs.
- Moved logo generation to one shared pipeline so brand updates can propagate across web, desktop, and iOS helper assets from one place.
- Promoted the helper IPA to a first-class release artifact and pointed the official source feed at the latest published helper asset.
- Reworked the repository surface with a stronger single README and an Apache-2.0 license + NOTICE distribution.

### Release Engineering Changes

| Area | Change | Why it matters |
| --- | --- | --- |
| Branding assets | `scripts/generate-icon-assets.py` now emits desktop, web, and iOS helper brand assets | Future logo updates only need one source change |
| Release assets | GitHub release publishing now includes `helper/SidelinkHelper.ipa` | Users can install the helper directly from release assets |
| Packaging | Desktop packaging can bundle either a freshly exported or committed helper IPA | Release and local packaging are less fragile |
| License surface | Project metadata now ships under Apache-2.0 with a `NOTICE` file | The legal surface is clearer for redistribution and derivative work |

## v0.2.0

### Highlights

- Hardened desktop release packaging for macOS with architecture-specific build jobs
- Added packaged-app smoke testing so release builds must prove they can start before artifacts are published
- Refreshed the docs site with a stronger visual system and GitHub Pages-ready VitePress configuration
- Clarified first-run authentication so desktop launch no longer relies on seeded credentials

### Release Engineering Changes

| Area | Change | Why it matters |
| --- | --- | --- |
| macOS builds | Separate `mac-arm64` and `mac-x64` release jobs | Prevents cross-arch native module mismatches from slipping into DMG artifacts |
| Packaged startup | `desktop:smoke` launches the packaged app in smoke-test mode | Catches startup regressions before GitHub Release upload |
| Docs hosting | VitePress base path now matches GitHub Pages project hosting | Prevents broken asset URLs on `https://gabrielvuksani.github.io/sidelink/` |
| First-run auth | Desktop first launch now requires explicit admin creation | Removes shipped default credentials from the release path |

### Release Checklist

1. Confirm `package.json` version and `CHANGELOG.md` match the target release.
2. Run `npm run verify` locally.
3. If packaging on macOS locally, run `npm run desktop:package` and then `npm run desktop:smoke`.
4. Push the tagged release from `main` so GitHub Actions can build and publish artifacts.
5. Confirm the docs workflow deployed successfully to GitHub Pages.

### Tag Policy

- Cut release tags only from the exact `origin/main` tip you intend to publish.
- Treat published semver tags as immutable. Do not force-move a tag after assets are released.
- If release automation or docs publishing needs a follow-up fix after publish, land that fix on `main` and roll it into the next version instead of rewriting the existing release tag.

::: tip Release URL
Once GitHub Pages is enabled with `Source = GitHub Actions`, the docs site publishes to `https://gabrielvuksani.github.io/sidelink/`.
:::