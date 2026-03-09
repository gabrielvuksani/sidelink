# Troubleshooting

Use this page when launch, pairing, sign-in, source, install, packaging, or helper workflows behave differently than expected.

## App Won't Pair

- Verify server is reachable from phone network.
- Generate a new pairing code and enter all 6 digits.
- Confirm helper and desktop clocks are roughly in sync.
- Prefer the 6-digit code first. If QR is failing, do not block on camera access.
- Confirm Local Network access was granted on iPhone if desktop discovery never appears.

## Device Not Detected

- Reconnect USB cable and unlock device.
- Confirm trust prompt accepted on iPhone.
- Run `pymobiledevice3 usbmux list --usb` from `.venv`.
- If the desktop app is already open, use Devices -> Refresh before assuming the server cannot see the phone.
- If Wi-Fi discovery is unreliable, test with USB first so you are debugging one transport at a time.

## Apple Sign-In Fails

- Retry with app-specific trusted-device 2FA flow.
- Confirm anisette helper scripts can execute.
- Check system time and timezone on host.
- If sign-in works in development but fails in a packaged app, treat that as a packaged runtime issue, not just an Apple credential issue.

## Source Feed Or Downloads Look Wrong

- Run `npm run source:generate` and confirm `docs/source/source.json` changed as expected.
- If an app name, subtitle, developer, or description is generic, add a same-name JSON override in `docs/source/apps/`.
- If the source manifest points at the wrong app name, verify the IPA `Info.plist` and the companion JSON basename match exactly.
- If a release asset is missing, check that the IPA exists under `docs/source/apps/` before the release tag is pushed.

## Official Source App Does Not Install

- Confirm the release exists on GitHub and the IPA asset was uploaded.
- Open the direct `latest/download/...ipa` URL in a browser to verify the asset resolves.
- Confirm the source feed URL is the raw GitHub manifest, not the docs page URL.
- Re-add the source if AltStore or SideStore cached an older version.

## Build Errors

- Run `npm install` again to refresh dependencies.
- Run `npm run node:preflight` for native module checks.
- Ensure Node.js major version is 20+.

## Downloaded DMG App Crashes On Launch

- Confirm the release was built after the packaged-runtime hardening carried through `v0.3.1`.
- Check that the release workflow completed the packaged smoke test.
- Reproduce locally with `npm run desktop:package` followed by `npm run desktop:smoke`.
- If Apple auth or device discovery fails only in the packaged app, check desktop diagnostics for bundled helper runtime health before assuming the app itself is corrupt.
- If macOS is blocking launch for Gatekeeper reasons, treat that separately from an actual runtime crash.

## Helper Build Fails

- Confirm full Xcode is installed.
- Install `xcodegen` and set `SIDELINK_TEAM_ID`.
- Re-run `npm run helper:build` then `npm run helper:export`.
- If new Swift files were added, regenerate the helper project from `project.yml` before debugging further.

## Docs Site Looks Stale

- Build locally with `npm run docs:build`.
- Confirm GitHub Pages is configured to use GitHub Actions.
- Make sure the docs workflow ran on `main` after the docs change landed.
- If the docs page is new, confirm it was added to the VitePress sidebar/nav so users can actually find it.
