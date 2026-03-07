# Troubleshooting

Use this page when launch, pairing, sign-in, packaging, or helper workflows behave differently than expected.

## App Won't Pair

- Verify server is reachable from phone network.
- Generate a new pairing code and enter all 6 digits.
- Confirm helper and desktop clocks are roughly in sync.

## Device Not Detected

- Reconnect USB cable and unlock device.
- Confirm trust prompt accepted on iPhone.
- Run `pymobiledevice3 usbmux list --usb` from `.venv`.

## Apple Sign-In Fails

- Retry with app-specific trusted-device 2FA flow.
- Confirm anisette helper scripts can execute.
- Check system time and timezone on host.

## Build Errors

- Run `npm install` again to refresh dependencies.
- Run `npm run node:preflight` for native module checks.
- Ensure Node.js major version is 20+.

## Downloaded DMG App Crashes On Launch

- Confirm the release was built after the `v0.2.0` packaging changes.
- Check that the release workflow completed the packaged smoke test.
- Reproduce locally with `npm run desktop:package` followed by `npm run desktop:smoke`.
- If macOS is blocking launch for Gatekeeper reasons, treat that separately from an actual runtime crash.

## Helper Build Fails

- Confirm full Xcode is installed.
- Install `xcodegen` and set `SIDELINK_TEAM_ID`.
- Re-run `npm run helper:build` then `npm run helper:export`.
