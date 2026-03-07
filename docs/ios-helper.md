# iOS Helper

The iOS Helper app lets you pair your phone with your desktop server and monitor installs/refresh state directly on-device.

## Role In The Product

The helper is not a separate admin tool. It is the paired on-device view into the same install, refresh, and signing state that the desktop app manages.

## Pairing

1. Open desktop Settings and generate/view pairing code.
2. Open iOS Helper and enter the 6-digit code.
3. Helper stores token and syncs status, devices, accounts, and jobs.

## Build Helper IPA

```bash
export SIDELINK_TEAM_ID=YOUR_TEAM_ID
npm run helper:build
npm run helper:export
```

If you just want the easiest path from the desktop app, use Settings -> iOS Helper -> One-Click Build / Import. That flow auto-detects the helper IPA and imports it into your library.

Output IPA:

- `tmp/helper/SidelinkHelper.ipa`

## Features

- Browse and install apps from your library and sources
- View install logs and submit 2FA inline
- Trigger refresh jobs
- Track expiry and slot usage

## Practical Flow

1. Pair from the desktop Settings page.
2. Confirm the helper can see current devices, Apple IDs, and install state.
3. Use it to monitor installs, finish 2FA, and check refresh pressure when you are away from the desktop shell.

## Production Notes

- Settings uses a dedicated pairing page to avoid keyboard lockup
- Background refresh interval is configurable
- iOS app icon is generated into `Assets.xcassets/AppIcon.appiconset`
