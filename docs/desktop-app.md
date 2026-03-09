# Desktop App

SideLink Desktop is the Electron shell around the web control center. It gives you the same install, device, source, and Apple-account workflow as the browser UI, plus tray behavior, packaging, and update plumbing.

## Best Launch Command

```bash
npm run desktop:easy
```

Use this if you want the shortest reliable path into the full product.

Alternative development launch:

```bash
npm run desktop:dev
```

## What The Desktop App Handles

- Overview dashboard with live readiness and job state
- Install center and install history
- Apple ID sign-in, re-auth, App IDs, and certificates
- Device discovery and pairing
- Source management and self-hosted feed editing
- Helper IPA management and iPhone helper pairing
- Desktop packaging and auto-update metadata

## Main Pages

| Page | What it is for |
| --- | --- |
| Overview | Health snapshot, helper status, device count, job activity, and fast actions |
| Install | Start installs and review job history |
| Apps | IPA library, upload/import, and install entry points |
| Installed | Managed installs, refresh state, expiry pressure, and hidden App ID consumers |
| Devices | Refresh discovery and inspect connected devices |
| Apple ID | Sign in, re-auth, inspect certificates, and understand quota pressure |
| Sources | Add feeds, inspect trusted sources, and edit the public self-hosted manifest |
| Settings | System controls, release-facing diagnostics, and admin operations |

## Current Pairing Flow

The desktop now leads with the 6-digit helper pairing code.

Recommended flow:

1. Open the helper pairing card from the desktop.
2. Keep the short code visible.
3. Open the iPhone helper.
4. Enter the code manually.
5. Use QR only when the camera handoff is faster.

That keeps the desktop address and the connection state explicit instead of hiding the whole flow behind QR by default.

## Local Commands

| Command | Use it when |
| --- | --- |
| `npm run desktop:easy` | You want the fastest local desktop loop |
| `npm run desktop:dev` | You want a full build, preflight, and Electron launch |
| `npm run desktop:preflight` | You want to validate Electron-native dependencies before packaging |
| `npm run desktop:smoke` | You want to prove a packaged build actually starts |

## Packaging

```bash
npm run desktop:package
npm run desktop:package:win
npm run desktop:package:linux
npm run desktop:package:all
```

Packaging depends on:

- `build/icons/icon.icns` for macOS
- `build/icons/icon.ico` for Windows
- `python-bundle/dist/<platform>-<arch>/` for the bundled Python helper
- `resources/helper/SidelinkHelper.ipa` if you want the helper IPA bundled into the desktop build
- `dist/client/` for the control center assets

If brand assets changed:

```bash
npm run icon:generate
```

## Release-Safe Desktop Validation

Before you trust a packaged desktop build, run:

```bash
npm run verify
npm run desktop:package
npm run desktop:smoke
```

Why this matters:

- a clean TypeScript build is not enough
- a packaged app can fail even when development works
- the bundled Python runtime and native Electron modules need their own validation path

## Update Flow

Desktop releases use GitHub Releases as the update source.

Published artifacts include:

- `.dmg` and `.zip` for macOS
- `.exe` for Windows
- `.AppImage` and `.deb` for Linux
- `latest*.yml` metadata and blockmaps for updater flows

Current limitation:

- the in-app macOS update feed is published for the Apple silicon build
- Intel macOS builds are still downloadable, but manual update is safer until a separate x64-safe update feed is published

## Notes For Regular Users

- If the app launches but installs fail, check Apple ID and Devices first.
- If the app never reaches the dashboard, run `npm run desktop:preflight` or see [troubleshooting](/troubleshooting).
- If you only need SideLink apps, add the official source from [official-source](/official-source) instead of importing everything manually.
