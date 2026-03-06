# iOS Helper

The iOS Helper app lets you pair your phone with your desktop server and monitor installs/refresh state directly on-device.

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

## Production Notes

- Settings uses a dedicated pairing page to avoid keyboard lockup
- Background refresh interval is configurable
- iOS app icon is generated into `Assets.xcassets/AppIcon.appiconset`
