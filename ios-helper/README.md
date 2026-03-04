# Sidelink Helper (SwiftUI)

This folder contains the in-repo iOS helper app source used by Sidelink.

## What it does

- Shows installed app status + next auto-refresh window
- Shows connectivity and refresh health
- Triggers refresh through `/api/helper/refresh` when backend is reachable

## Generate Xcode project

```bash
cd ios-helper/SidelinkHelper
xcodegen generate
```

(If `xcodegen` is missing: `brew install xcodegen`.)

## Build

```bash
bash scripts/helper-build.sh
```

## Export IPA

```bash
bash scripts/helper-export.sh
```

By default, IPA output path is:

```text
tmp/helper/SidelinkHelper.ipa
```

This path is auto-detected by backend helper orchestration and used during install pipeline.

## Tooling constraints

If this environment does not have full Xcode + signing setup, the app source still remains complete and versioned here.
Use a macOS machine with full Xcode, valid Apple Development signing, and provisioning to build/export IPA.
