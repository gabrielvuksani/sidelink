# iOS Helper

The iPhone helper is the on-device SideLink companion. It pairs with your desktop session, shows install and refresh state, browses sources, and lets you keep working when you are away from the desktop.

## What The Helper Is For

- Pairing your phone to the SideLink desktop/backend
- Browsing source feeds and IPA library items on device
- Starting installs from the phone
- Following live install state and logs
- Submitting Apple 2FA without losing install context
- Watching expiry, refresh pressure, and managed app state

## Current Pairing Model

SideLink now uses a code-first pairing flow.

Recommended path:

1. Open the pairing card on desktop.
2. Keep the 6-digit code visible.
3. Open the helper.
4. Grant the requested permissions.
5. Enter the code manually.
6. Use QR only when the camera handoff is more convenient.

Why this changed:

- manual code entry is clearer for first-time users
- it keeps the backend address explicit
- it avoids turning camera access into the default requirement

## Permissions

The helper now asks for the permissions it actually uses up front and shows their current status later in Settings.

| Permission | Why the helper asks for it |
| --- | --- |
| Notifications | Refresh and install status updates |
| Camera | Optional QR pairing |
| Local Network | Desktop helper discovery and nearby pairing |
| Background Refresh | Automatic app refresh checks |

If a permission was denied earlier, the helper points users back to iOS Settings instead of leaving them guessing.

## Main Helper Tabs

| Tab | What it does |
| --- | --- |
| Browse | Explore the source catalog available to the paired SideLink instance |
| Search | Find apps from enabled source feeds |
| Installed | Review managed installs, refresh state, hidden quota pressure, and imported IPAs |
| Settings | Pair or repair, inspect helper status, manage permissions, and view connected server details |

## Installed Tab Improvements In `v0.3.1`

The helper Installed tab now shows more than a basic install list.

It now surfaces:

- active managed installs
- deactivated installs
- imported IPA library items
- hidden App ID consumers
- unmanaged apps present on the selected device
- auto-refresh state and expiry pressure

That brings the iPhone view closer to the desktop installed-management surface.

## Helper Build And Export

On macOS:

```bash
export SIDELINK_TEAM_ID=YOUR_TEAM_ID
npm run helper:build
npm run helper:export
```

Expected output:

- `tmp/helper/SidelinkHelper.ipa`

If you add new Swift files, remember that the Xcode project is generated from `ios-helper/SidelinkHelper/project.yml`, so the project may need regeneration before Xcode sees the new files.

## Desktop-Assisted Helper Flow

If you prefer not to build/export by hand, the desktop helper controls can:

- validate helper readiness
- import the helper IPA into the SideLink library
- create the pairing code
- show the optional QR handoff

## Practical On-Device Flow

1. Pair the helper to the desktop.
2. Confirm the helper sees your SideLink state.
3. Browse sources or open your IPA library.
4. Start an install.
5. Enter 2FA inside the helper if Apple requests it.
6. Use Installed to watch expiry and refresh health later.

## Public Download

The helper IPA is also published through the official SideLink source and GitHub Releases. See [official-source](/official-source) for the source URL and direct download links.
