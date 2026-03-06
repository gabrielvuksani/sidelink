# Sidelink Helper (SwiftUI)

This folder contains the in-repo iOS helper app source used by Sidelink.

## What it does

- Shows installed app status + next auto-refresh window
- Shows connectivity and refresh health
- Triggers refresh through `/api/helper/refresh` when backend is reachable

## Prerequisites

- **macOS** with full **Xcode** installed (not just Command Line Tools)
- An Apple ID signed into Xcode (free or paid)
- **xcodegen** (`brew install xcodegen`) — only needed if `.xcodeproj` doesn't exist

### Finding your Team ID

1. Open **Xcode → Settings → Accounts**
2. Select your Apple ID, then look at the team listed (e.g., "Personal Team")
3. The 10-character alphanumeric string is your Team ID

```bash
export SIDELINK_TEAM_ID=YOUR_TEAM_ID
```

### Free vs Paid Apple Account

| Feature | Free Apple ID | Paid ($99/yr) |
|---------|:---:|:---:|
| Build helper locally | ✅ | ✅ |
| Install on your device | ✅ | ✅ |
| Signing validity | **7 days** | 1 year |
| Max 3 active App IDs | ✅ | No limit |

With a free account, provisioning profiles expire every 7 days.
You'll need to re-build and re-install the helper weekly.

## Generate Xcode project

```bash
cd ios-helper/SidelinkHelper
xcodegen generate
```

(If `xcodegen` is missing: `brew install xcodegen`.)

## Build

```bash
export SIDELINK_TEAM_ID=YOUR_TEAM_ID
bash scripts/helper-build.sh
```

## Export IPA

```bash
export SIDELINK_TEAM_ID=YOUR_TEAM_ID
bash scripts/helper-export.sh
```

By default, IPA output path is:

```text
tmp/helper/SidelinkHelper.ipa
```

This path is auto-detected by backend helper orchestration and used during install pipeline.

## Troubleshooting

- **"No signing certificate"**: Open Xcode, go to Settings → Accounts, select your team, and click "Manage Certificates". Create an "Apple Development" certificate if none exists.
- **"SIDELINK_TEAM_ID not set"**: Run `export SIDELINK_TEAM_ID=<your-team-id>` before building.
- **Provisioning profile expired (free account)**: Re-run the build + export scripts. Free profiles last 7 days.
