# Sidelink Official Source

This folder hosts Sidelink's official AltStore-compatible source feed.

- `source.json` is the canonical published feed.
- `../source.json` is kept as a compatibility mirror for older clients and links.
- Use existing repository assets or release artifacts in the manifest so the feed never points at missing files.

When adding more apps later, append them to `source.json` and keep the `sourceURL` pointed at this folder-based path.

Only update manifest download URLs after the matching GitHub Release assets exist.
