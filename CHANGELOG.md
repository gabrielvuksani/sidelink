# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

## [0.2.0] - 2026-03-07

### Added
- Packaged desktop smoke testing for release validation.
- Architecture-specific macOS release jobs for `arm64` and `x64` artifacts.
- GitHub Pages-ready VitePress base-path configuration and refreshed docs site theming.
- `npm run desktop:smoke` for validating packaged startup locally.

### Changed
- Desktop launch no longer seeds a default admin username or password.
- Release workflow now validates Electron-native dependencies before packaging.
- Docs navigation and landing experience were redesigned for a stronger product-style presentation.

## [0.1.0] - 2026-03-06

### Added
- Initial public release of Sidelink.
- Express API server for auth, Apple accounts, devices, IPA uploads, and install jobs.
- Cross-platform TypeScript IPA signing pipeline.
- Electron desktop app with updater integration.
- React client control center with setup wizard and install management.
- iOS helper app project and helper build/export scripts.
- SQLite persistence, typed errors, and core security middleware.
- VitePress documentation structure under `docs/`.
- GitHub Pages docs deployment workflow.
- Operational scripts: `npm run doctor` and `npm run reset:dev`.
- Dedicated iOS helper pairing sheet and improved small-screen SwiftUI layouts.
- iOS AppIcon asset generation in `scripts/generate-icon-assets.py`.

### Changed
- README converted to docs-first quick-start format.
- Branding glyph unified across desktop/web login surfaces.
