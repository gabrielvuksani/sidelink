# Changelog

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
