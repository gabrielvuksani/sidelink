# Release Notes

This page tracks the user-visible release surface and the release-engineering changes that matter when you publish SideLink.

## v0.3.1

### Highlights

- Made manual pairing codes the default helper pairing path on both iPhone and desktop, while keeping QR available as a secondary option instead of the first decision point.
- Upgraded iPhone onboarding and settings so permissions are requested immediately, current permission state stays visible, and every permission row exposes a live status-aware action.
- Brought the iPhone Installed tab closer to the desktop management surface with App ID quota visibility, hidden-consumer counts, unmanaged installed apps, and refresh-state insight.
- Tightened helper polish and stability with shared native status cards, a cleaner pairing hero, and simulator-build-driven fixes for onboarding, refresh loading, and Installed-tab composition.
- Expanded the docs site into a fuller user-and-operator guide, including a dedicated official-source page and clearer setup, desktop, helper, and troubleshooting guidance.
- Added the first non-helper public IPA listing to the official source so users can download Cortex directly from the source feed or the matching release asset.

### Release Engineering Changes

| Area | Change | Why it matters |
| --- | --- | --- |
| Pairing flow | iPhone onboarding, settings pairing, desktop overview messaging, and helper control surfaces now lead with the 6-digit pairing code and demote QR to a supporting action | The product now has one obvious pairing path instead of splitting attention between two equally weighted entry points |
| Helper permissions | `PermissionsCoordinator` centralizes notification, camera, local-network, and background-refresh status plus request flows | Permission prompts, status chips, and follow-up actions stay consistent between startup, onboarding, and settings |
| Installed management | The helper Installed tab now surfaces free-account quotas, hidden App ID consumers, unmanaged apps, and auto-refresh state | Operators can see capacity pressure and refresh risk on-device instead of switching back to desktop to understand why installs stall |
| Build validation | The helper project was regenerated from `project.yml`, and the final simulator build passed after fixing view-model refresh orchestration and SwiftUI composition issues | The shipped iPhone helper changes are backed by a real Xcode build rather than editor-only diagnostics |
| Release docs | README, changelog, release notes, and release-command examples now align on `v0.3.1` | The release surface reads consistently for maintainers and users following the current cut |
| Official source | The docs now explain the public source feed, direct IPA downloads, and release-hosted app assets, and the source catalog now includes Cortex | Users can discover and download public IPAs without digging through repo internals |

## v0.3.0

### Highlights

- Polished the first-run desktop experience so onboarding feels like the product instead of a crowded setup screen.
- Made iPhone helper IPA imports first-class installs: importing from Files or a URL now opens the install console immediately and continues through the normal signing flow.
- Stabilized install-job 2FA handling on the helper so the install console stays present while Apple verification is in progress.
- Closed the last packaged Apple runtime gap by correctly treating locally built bundled helpers as bundled runtimes during diagnostics and release validation.
- Rewrote the root README into a stronger launch document for users, operators, and contributors.

### Release Engineering Changes

| Area | Change | Why it matters |
| --- | --- | --- |
| Desktop onboarding | `SetupWizard` now uses a tighter, less fragmented desktop layout with compact step context inside the primary surface | First launch reads like one deliberate control center instead of multiple competing panels |
| iPhone helper import flow | Helper URL and Files imports now route directly into `startInstall(...)` and the install console | Imported IPAs no longer stall in the library without showing live install state |
| Helper 2FA resilience | Install-console presentation now guards against dismissal while an install job is waiting on 2FA | Users can enter Apple verification codes without losing the active install context |
| Packaged Apple runtime | Bundled-helper detection now recognizes local `python-bundle/dist/<platform>-<arch>/` helpers as bundled runtimes | Release diagnostics stop misclassifying the packaged helper and avoid the `--command` invocation failure |
| Release docs | README, changelog, release notes, and operator examples now align on `v0.3.0` | The release surface is coherent for both end users and maintainers |

## v0.2.6

### Highlights

- Fixed the released desktop app's packaged Apple sign-in and device detection paths by repairing the bundled Python helper instead of relying on development-only behavior.
- Bundled the missing anisette assets, `pymobiledevice3` submodules, and CLI metadata the frozen helper needs inside the shipped macOS app.
- Strengthened packaged smoke coverage so release validation now catches broken anisette generation and bundled device-command regressions before publish.
- Tightened the onboarding layout so the main wizard column and right-hand support rail align cleanly on desktop.

### Release Engineering Changes

| Area | Change | Why it matters |
| --- | --- | --- |
| Packaged desktop runtime | `python-bundle/entry.py` now uses the current anisette API, preserves option-style `pmd3` arguments, and dispatches through the packaged `pymobiledevice3` entrypoint | The downloaded DMG now exercises the same Apple auth and device flows that work in development instead of failing behind generic server errors |
| Frozen helper build | `python-bundle/build.py` now collects anisette package data, Unicorn pieces, `pymobiledevice3` submodules, and CLI package metadata | PyInstaller no longer drops runtime resources the packaged helper needs after local tests have already passed |
| Release smoke | `scripts/smoke-packaged-app.cjs` now validates helper self-check, anisette generation, bundled `pmd3 usbmux list --usb`, and GSA dispatch | Broken packaged auth or device flows are blocked before a release tag publishes a DMG |
| Onboarding polish | `SetupWizard` now top-aligns its content and keeps the desktop support rail sticky and aligned | First-run setup reads as one composed surface instead of two misaligned panes |

## v0.2.5

### Highlights

- Fixed the packaged Apple sign-in path so the released desktop app exercises the same GSA helper dispatch boundary that local smoke validation checks.
- Completed the onboarding 2FA flow by propagating trusted phone metadata through the API and wiring SMS delivery requests to the backend helper instead of leaving them as a stub.
- Cleaned up helper and desktop build hygiene so local release preparation no longer spills generated Python and helper export files into git status.

### Release Engineering Changes

| Area | Change | Why it matters |
| --- | --- | --- |
| Packaged Apple auth | Desktop smoke and packaged runtime continue through the bundled GSA helper entrypoint instead of a dev-only path | Prevents released macOS builds from regressing into generic onboarding auth failures |
| 2FA contract | Backend 2FA responses now surface trusted phone metadata when Apple provides it, and SMS triggers now execute the helper request path | Keeps onboarding and account sign-in aligned with the server behavior instead of showing dead-end UI affordances |
| Repo hygiene | `.gitignore` now excludes Python helper build output, bytecode caches, and helper export worktrees | Keeps release commits focused on source changes instead of generated artifacts |

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