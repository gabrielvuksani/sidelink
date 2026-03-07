# Release Notes

This page tracks the user-visible release surface and the release-engineering changes that matter when you publish Sidelink.

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

::: tip Release URL
Once GitHub Pages is enabled with `Source = GitHub Actions`, the docs site publishes to `https://gabrielvuksani.github.io/sidelink/`.
:::