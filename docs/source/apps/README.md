# Source Apps Drop Zone

Drop `.ipa` files here to add them to the SideLink official source feed.

If you want this folder to behave like a live drop zone while you work, run `npm run source:watch` once and leave it running.

## How it works

1. **Start** `npm run source:watch` once, or run `npm run source:generate` on demand
2. **Drop your IPA** into this folder (`docs/source/apps/`)
3. The script reads each IPA's `Info.plist`, extracts the bundle ID / name / version, and regenerates `docs/source/source.json`
4. **Commit & push** — the next release will automatically upload all IPAs from this folder as GitHub Release assets

The source feed is also regenerated during `npm run verify`, so you can't forget.

## Multiple versions

If you add multiple `.ipa` files with the same bundle ID, the generator keeps them under one app entry and appends multiple `versions[]` entries instead of failing on a duplicate bundle ID.

Use distinct filenames for each uploaded release asset.

## Optional metadata overrides

Create a JSON file with the **same basename** as your IPA to customise the listing:

```
docs/source/apps/
  MyApp.ipa          ← the app
  MyApp.json         ← metadata overrides (optional)
```

### Override schema

All fields are optional. Anything you omit gets a sensible default.

```jsonc
{
  "name":                 "My Cool App",        // display name (default: from Info.plist)
  "developerName":        "Your Name",          // default: "Unknown"
  "subtitle":             "Short tagline",
  "localizedDescription": "Full description…",
  "iconURL":              "https://…/icon.png", // default: SideLink icon
  "tintColor":            "#ff6600",            // default: "#1f9fbf"
  "featured":             true,                 // add to featured apps list
  "versionDate":          "2026-03-08",         // default: IPA file modified date
  "versionDescription":   "What's new",         // default: "Version X.Y.Z"
  "appPermissions": {
    "entitlements": ["com.apple.security.application-groups"],
    "privacy": ["Camera: Used for AR features"]
  }
}
```

App-level fields come from the highest-version IPA for a given bundle ID. `versionDescription` and `versionDate` apply to the specific IPA next to that JSON file.

## Download URLs

Download URLs point to **GitHub Release assets** using the `latest` tag:

```
https://github.com/gabrielvuksani/sidelink/releases/latest/download/<filename>.ipa
```

The release workflow uploads every IPA from this folder automatically.
