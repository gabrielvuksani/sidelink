# Changelog

## [0.2.6] - 2026-03-08

### Fixed

- Fixed the packaged desktop helper so released macOS builds can generate anisette data, complete Apple sign-in, and execute bundled `pymobiledevice3` device commands instead of failing only after packaging.
- Added the missing packaged Python assets and metadata required by the frozen helper runtime, including anisette package data, Unicorn support, and CLI metadata needed by the bundled device tooling.
- Hardened packaged desktop smoke validation so releases now exercise helper self-checks, anisette generation, bundled `pmd3 usbmux list --usb`, and GSA helper dispatch before a broken DMG can ship.
- Polished the onboarding layout so the main setup flow and the supporting right rail stay aligned on desktop instead of visually drifting apart.

## [0.2.5] - 2026-03-07

### Fixed

- Fixed the packaged Apple authentication path so onboarding and desktop smoke exercise the same helper dispatch boundary instead of diverging between development and packaged builds.
- Completed the onboarding 2FA workflow by returning trusted phone metadata when Apple exposes it and by wiring the SMS trigger path through the backend instead of leaving it as a no-op.
- Ignored generated Python helper build output and helper export artifacts so desktop release work no longer dirties the repository with local build products.

## [0.2.4] - 2026-03-07

### Fixed

- Published the macOS arm64 updater feed assets needed by Electron auto-update so packaged Apple silicon desktop builds can fetch release metadata instead of failing on `latest-mac.yml`.
- Added clearer desktop updater errors when release metadata is missing and prevented Intel macOS builds from offering a broken in-app update path before a separate x64-safe feed exists.

### Added

- Added a desktop factory reset action in Settings that wipes local SideLink state, clears the stored encryption key, and relaunches into a true first-run setup flow.

## [0.2.3] - 2026-03-07

### Fixed

- Restored the executable bit on the bundled Python helper during desktop packaging so released macOS builds can actually run the packaged readiness, Apple auth, and device runtime.
- Bundled Unicorn native runtime assets into the packaged Python helper so macOS release builds no longer fail when anisette and device tooling initialize inside the shipped app.
- Hardened packaged helper self-check handling so warning-prefixed output does not break desktop smoke validation.

## [0.2.2] - 2026-03-07

### Changed

- Redesigned the desktop onboarding surface to match the stronger SideLink control-center visual language.
- Added an overview-level desktop readiness panel so packaged runtime, helper IPA, Apple signing readiness, and device visibility are obvious before users hit dead ends.
- Hardened local desktop packaging so it refuses to build without the bundled Python helper and now smoke-tests that helper inside the packaged app.
- Trimmed GitHub Release publishing to ship only the helper IPA, DMGs, Windows EXEs, and Linux AppImage/DEB artifacts.

## [0.2.1] - 2026-03-07

### Changed

- Renamed displayed product branding from Sidelink to SideLink across desktop, web, helper, docs, and source metadata.
- Centralized logo generation so desktop, web, and iOS helper assets now come from one shared generator pipeline.
- Consolidated the repo documentation surface around the root README and docs site release notes.
- Updated licensing from MIT to Apache-2.0 with a NOTICE file.
- GitHub Releases now publish the helper IPA and official source manifests now target the latest helper asset.

Release notes moved to the docs site so publish notes, docs deployment guidance, and release policy stay in one place.

- Current notes: `docs/release-notes.md`
- Published page: `https://gabrielvuksani.github.io/sidelink/release-notes`
