# Official Source

Use this page if you want the public SideLink source feed, direct IPA downloads, or a clear explanation of how app assets reach users.

## What This Source Is

The official SideLink source is an AltStore-compatible JSON feed published from this repository and backed by GitHub Release assets.

Canonical feed URL:

`https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source/source.json`

Release assets page:

`https://github.com/gabrielvuksani/sidelink/releases`

## Add It To AltStore Or SideStore

1. Copy the feed URL above.
2. Open your source manager in AltStore or SideStore.
3. Add a new source.
4. Paste the URL.
5. Refresh sources.

If you only want a direct file download, use the download links below instead.

## Current Apps In The Official Source

| App | What it is | Install path |
| --- | --- | --- |
| SideLink Helper | The official iPhone companion for pairing, browsing feeds, installs, 2FA, and refresh monitoring | Add the source or download the IPA directly |
| Cortex | A local-first iPhone app for on-device LLM conversations, voice dictation, image-aware prompts, and offline model workflows | Add the source or download the IPA directly |

## Direct Download Links

These URLs always target the latest tagged release assets.

| Asset | Direct URL |
| --- | --- |
| SideLink Helper | `https://github.com/gabrielvuksani/sidelink/releases/latest/download/SidelinkHelper.ipa` |
| Cortex | `https://github.com/gabrielvuksani/sidelink/releases/latest/download/Cortex.ipa` |

## Cortex Listing

Current public listing details:

- Name: Cortex
- Bundle ID: `com.cortex.app`
- Version: `1.0.0`
- Minimum iOS: `17.0`
- Developer: Gabriel Vuksani

What Cortex is described as in the official feed:

- local-first LLM chat on iPhone
- optional image input from camera or photo library
- optional dictated prompts using microphone and speech recognition
- on-device analysis rather than a remote conversation relay as the default product story

## How Publishing Works

The source manifest is generated from the repository contents.

Source publishing flow:

1. Put an IPA in `docs/source/apps/`.
2. Add an optional same-name JSON file for title, subtitle, description, developer name, icon URL, permissions, and version notes.
3. Run `npm run source:generate`.
4. Tag and push the release.
5. GitHub Actions uploads every IPA in `docs/source/apps/` to the release.
6. The source manifest points users at those `latest/download/...ipa` assets.

That means the source manifest, docs page, and release assets stay aligned if the repo contents are correct before tagging.

## Where The Manifest Lives

Generated files:

- `docs/source/source.json`
- `docs/source.json`

App drop zone:

- `docs/source/apps/`

## Notes For Maintainers

- Use companion JSON overrides whenever a raw IPA would produce a vague listing.
- Keep filenames stable so release assets remain predictable.
- Run `npm run verify` before tagging, because it regenerates the source and catches stale docs/build problems.