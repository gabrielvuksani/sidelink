# Release Notes

This page tracks the user-visible release surface and the release-engineering changes that matter when you publish SideLink.

## v0.2.4

### Highlights

- Restored packaged desktop auto-update for Apple silicon macOS releases by publishing the updater manifest, matching zip, and blockmap assets GitHub Releases was missing.
- Added a factory reset action in Desktop Settings so you can wipe local data, secrets, and cached runtime state without manually hunting through SideLink support directories.
- Hardened the updater UX so missing release metadata shows a concrete operator-facing error, and Intel macOS builds now fall back to manual DMG updates instead of advertising a broken in-app path.

### Release Engineering Changes

| Area | Change | Why it matters |
| --- | --- | --- |
| GitHub release assets | `release.yml` now publishes the arm64 macOS updater zip, `latest-mac.yml`, and blockmap files alongside the DMG | `electron-updater` can now resolve the live Apple silicon macOS feed instead of failing with a 404 on missing metadata |
| Desktop recovery | Electron main/preload/IPC now support a relaunch-driven factory reset from Settings | Operators can recover a corrupted local desktop install without manual filesystem or keychain cleanup |
| macOS update policy | Intel macOS builds now explicitly use manual updates until the pipeline can publish a separate x64-safe manifest | Prevents ambiguous `latest-mac.yml` feeds from sending Intel builds down a broken in-app update path |

## v0.2.3

### Highlights

- Fixed the packaged macOS desktop build so the bundled Python helper keeps executable permissions after the CI artifact handoff.
- Bundled the native Unicorn runtime required by the packaged Python helper so Apple auth and device flows can actually start inside the released app.
- Preserved the tighter public release surface from `v0.2.2`: helper IPA, DMGs, Windows EXEs, and Linux AppImage/DEB files only.

### Release Engineering Changes

| Area | Change | Why it matters |
| --- | --- | --- |
| Packaged mac runtime | `beforePack` now restores execute permissions on the bundled `sidelink-python` helper before Electron packages the app | Prevents released DMGs from failing packaged smoke checks with `EACCES` when Apple auth and device tooling start |
| Bundled Python helper | `python-bundle/build.py` now explicitly collects Unicorn native libraries and the helper entrypoint suppresses dependency-warning noise | Prevents packaged Apple auth and device commands from failing or corrupting JSON responses inside the shipped app |
| Release asset surface | GitHub Releases still publish only `.ipa`, `.dmg`, `.exe`, `.AppImage`, and `.deb` assets | Keeps the release page limited to directly usable installer/download artifacts |

## v0.2.2

### Highlights

- Reworked the first-run desktop onboarding so it feels like the actual product instead of a placeholder setup form.
- Added an overview-level readiness panel that exposes runtime health, helper availability, Apple signing readiness, and device visibility in one place.
- Tightened local desktop packaging and smoke testing around the bundled Python helper used by Apple auth and device tooling.
- Reduced the public release surface to the files users actually need: helper IPA, DMGs, Windows EXEs, and Linux desktop artifacts.

### Release Engineering Changes

| Area | Change | Why it matters |
| --- | --- | --- |
| Onboarding UI | Setup wizard now uses the same stronger desktop visual language and macOS titlebar inset spacing | First launch feels deliberate and leaves room for the traffic-light controls on macOS |
| Runtime diagnostics | Overview now includes a desktop readiness panel backed by health + helper diagnostics | Packaged-app failures are surfaced as concrete readiness gaps instead of vague broken behavior |
| Local packaging | `npm run desktop:package` now builds the bundled Python helper first and `beforePack` fails if it is missing | Prevents shipping a desktop build that cannot perform Apple auth or device discovery |
| Release assets | GitHub Releases now publish only `.ipa`, `.dmg`, `.exe`, `.AppImage`, and `.deb` assets | Keeps the release page focused on directly usable installer/download artifacts |

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
3. On macOS, run `npm run helper:export` so `tmp/helper/SidelinkHelper.ipa` exists before tagging.
4. If packaging on macOS locally, run `npm run desktop:package` and then `npm run desktop:smoke`.
5. Push the tagged release from `main` so GitHub Actions can build and publish artifacts.
6. Confirm the docs workflow deployed successfully to GitHub Pages.

### Tag Policy

- Cut release tags only from the exact `origin/main` tip you intend to publish.
- Treat published semver tags as immutable. Do not force-move a tag after assets are released.
- If release automation or docs publishing needs a follow-up fix after publish, land that fix on `main` and roll it into the next version instead of rewriting the existing release tag.

::: tip Release URL
Once GitHub Pages is enabled with `Source = GitHub Actions`, the docs site publishes to `https://gabrielvuksani.github.io/sidelink/`.
:::