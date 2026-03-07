# Desktop App

SideLink Desktop wraps the web control center in Electron with tray integration, auto-updates, and deep links.

## Run

```bash
npm run desktop:easy
```

Alternative dev launch:

```bash
npm run desktop:dev
```

`npm run desktop:easy` is the preferred local path. It builds the server/client, runs native dependency preflight, prepares the local database, and launches Electron against the local data directory. On first launch, create the admin account in the setup flow instead of relying on a seeded default login.

## Local Commands

| Command | Use it when |
| --- | --- |
| `npm run desktop:easy` | You want the shortest local launch path |
| `npm run desktop:dev` | You want the full build + preflight + Electron launch path |
| `npm run desktop:preflight` | You want to validate Electron-native modules before startup |
| `npm run desktop:smoke` | You want to prove a packaged desktop build can actually start |

## Package Builds

```bash
npm run desktop:package
npm run desktop:package:win
npm run desktop:package:linux
npm run desktop:package:all
```

Packaging depends on generated icon assets and platform resources:

- `build/icons/icon.icns` for macOS
- `build/icons/icon.ico` for Windows
- `python-bundle/dist/<platform>-<arch>/` for the bundled Python helper
- `resources/helper/SidelinkHelper.ipa` when you want to ship a bundled iOS helper IPA
- `dist/client/` for the bundled React control center

Refresh the icon set before packaging if branding assets changed:

```bash
npm run icon:generate
```

For a full local validation pass before packaging:

```bash
npm run verify
```

## Release Safety

Starting in `v0.2.0`, the release path is stricter:

- macOS artifacts build in separate `arm64` and `x64` jobs
- release packaging must pass native Electron dependency validation
- the packaged app is smoke-tested before the release workflow uploads artifacts

That directly targets the class of failure where a DMG downloads successfully but the installed `.app` crashes immediately on launch.

## Update Flow

- Desktop checks release metadata from GitHub Releases
- Release workflow publishes platform artifacts and update manifests
- Users get in-app update banner

### Update artifacts

`electron-builder` publishes the release binaries plus YAML metadata used by `electron-updater`:

- `latest-mac.yml` / `latest.yml`
- blockmap files for differential download support
- per-platform archives (`.zip`, `.dmg`, `.exe`, `.AppImage`, `.deb`)

The repo also includes an `afterPack` hook that generates `app-update.yml` for packaged app resources when Electron's dir builds would otherwise omit it.

### Release pipeline expectations

- GitHub Releases is the update source (`package.json` publish provider points at `gabrielvuksani/sidelink`)
- Release workflow first validates that the tag version matches `package.json`
- Python helper bundles are built as separate workflow artifacts and downloaded into the matching packaging job for each platform and architecture
- The `GH_TOKEN` provided by GitHub Actions is used for draft release publication

For a manual workflow run, provide a `tag` input matching the target version in `package.json` and leave `dry_run` enabled if you only want to verify artifact generation.

## Notes

- macOS notarization is still separate from packaging correctness
- unsigned builds may still require Gatekeeper approval on first launch
- Windows and Linux release artifacts are produced by GitHub Actions; local macOS packaging mainly validates the mac target in this workspace
