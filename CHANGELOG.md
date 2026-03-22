# Changelog

## [0.4.1] - 2026-03-21

### Fixed

- Confirmed first-launch onboarding wizard flow works correctly with account creation, Apple ID setup, device detection, and IPA upload steps.

## [0.4.0] - 2026-03-21

### Changed

- Redesigned the sidebar layout with a compact brand header and status indicator, removing verbose workspace and runtime info cards.
- Simplified the main header to show page title, short description, and a single primary action instead of redundant navigation buttons.
- Overhauled the Dashboard page: replaced the generic time-based greeting with contextual status summaries, removed the widget layout editor UI, and simplified the widget grid to a fixed responsive layout.
- Shortened all page descriptions across the app from verbose multi-sentence copy to concise one-liners.
- Upgraded the Install page with horizontal pipeline steppers, prominent 2FA input with amber styling and auto-focus, date-grouped job history, and dismissible verify-app hints.
- Restructured the Settings page with tabbed sections (Automation, Security, System), scheduler "Run Now" and "Reset to defaults" buttons, and next-check countdown display.
- Upgraded the Logs page with color-coded log levels, per-entry copy buttons, export-to-file, improved tab bar filtering, and auto-scroll toggle.
- Improved the Installed page with search/filter, sort options, ExpiryBadge components, bulk "Refresh Expiring" action, and collapsible App ID management.
- Replaced raw search inputs on Sources and IPAs pages with the new SearchInput component.
- Added ExpiryBadge to Apple Account certificate display for visual consistency.

### Added

- Added a comprehensive CSS design system extension with 10 new component classes: skeleton loading, progress bars, search inputs, tooltips, badges, small/icon buttons, dividers, expiry urgency states, drag-and-drop zones, and pipeline steppers.
- Added a consolidated `Icons.tsx` component library with 30 reusable SVG icon components organized by category.
- Added 7 new shared UI components: `SearchInput` (debounced with clear button), `PipelineStepper` (horizontal pipeline visualization), `ExpiryBadge` (color-coded countdown), `DropZone` (drag-and-drop file zone), `Collapsible` (expandable sections), `TabBar` (accessible tab switching), and improved `ProgressBar`.
- Added error handling to Devices page reload that was previously silent on failure.
- Added iOS helper `Haptics` utility with impact, notification, and selection feedback.
- Added iOS helper `PulsingLoadingView` custom animated loading indicator.
- Added iOS helper `EmptyStateView` reusable component with icon, title, description, and action button.
- Added iOS helper semantic status color extensions (success, warning, error, info).
- Added iOS helper improved card styling with gradient backgrounds and dual-shadow depth.

### Fixed

- Fixed pre-existing `trustedPhoneNumbers` missing parameter bug in iOS helper HelperViewModel that was blocking builds.
- Fixed iOS helper SidelinkHelperApp.swift truncation that caused build failures.
- Fixed LogsPage tab bar using non-existent CSS classes (`sl-tab`, `sl-tab-active`) instead of proper `data-active` attributes.
- Fixed DashboardPage passing unused `emphasis` and `editing` props to OverviewStatCard.
- Rebuilt and exported latest iOS helper IPA with all DesignSystem improvements.

## [0.3.1] - 2026-03-09

### Changed

- Promoted manual helper pairing codes to the primary pairing path across the iPhone helper and desktop overview, with QR kept as a secondary fallback instead of competing with the default flow.
- Reworked the iPhone helper onboarding, settings, and pairing surfaces so permissions, readiness, and next actions read like one polished native flow rather than separate utility screens.
- Expanded the iPhone helper Installed tab into a fuller management surface with quota pressure, App ID consumer visibility, unmanaged app discovery, and per-app refresh state instead of a narrow installed-app list.

### Added

- Added a centralized iPhone permission coordinator that requests notifications, camera, local network, and background-refresh access up front and keeps status-aware action buttons in sync after changes.
- Added stronger helper status tiles and pairing cards shared across onboarding and settings so the helper exposes pairing health and permission state more clearly.
- Added release-note and operator-doc updates for the `v0.3.1` release path so current commands and release messaging match the shipped product surface.
- Added a much fuller docs site for setup, desktop usage, helper usage, source downloads, troubleshooting, and release operations instead of leaving critical details scattered across a few thin pages.
- Added the first public non-helper IPA listing to the official SideLink source feed with Cortex metadata and release-backed download URLs.

### Fixed

- Fixed multiple iPhone helper regressions uncovered by real simulator builds, including the onboarding closure break, Installed-tab compiler pressure, missing project-file inclusion for the new permissions source, and refresh-state loading issues in the helper view model.
- Fixed helper-side refresh visibility so App ID quota state, hidden consumers, and auto-refresh status load together during full refresh instead of partially updating or disappearing after pairing changes.

## [0.3.0] - 2026-03-08

### Changed

- Promoted SideLink into a `v0.3.0` release with a stronger release story across desktop, web, docs, and the iPhone helper instead of treating the current state as a string of patch-only packaging fixes.
- Reworked the desktop onboarding surface so the setup flow reads as one product surface, with less chrome, clearer outcomes, and less visual crowding during first launch.
- Refined the iPhone helper Installed tab to reduce refresh-control noise and keep the managed-install surface calmer during background activity.
- Expanded the root README into a fuller product and operator guide with clearer positioning, workflows, release expectations, and validation paths.

### Added

- Added immediate install-console handoff for helper IPA imports from Files and remote URLs so imported IPAs now behave like normal installs instead of stopping at library upload.
- Added install-console persistence during install-job 2FA so verification entry is no longer interrupted by accidental dismissal while a job is waiting for Apple verification.
- Added runtime-path detection coverage for locally built bundled Python helpers so pre-release validation catches packaged Apple runtime regressions before publish.
- Added `v0.3.0` release notes and refreshed release examples across the operator docs.

### Fixed

- Fixed the packaged desktop Apple runtime probe so locally built bundled helpers are detected as bundled helpers instead of being invoked like plain Python interpreters.
- Fixed helper import/install behavior on iPhone so importing an IPA from Files or a URL now opens the install console automatically and routes through the same install path as a regular install.
- Fixed install-console dismissal behavior during install-job 2FA so the sheet stays present until the operator explicitly closes it or the install state changes.

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
