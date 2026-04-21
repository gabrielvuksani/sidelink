# FAQ

## Does SideLink require AltServer?

No. SideLink is local-first and self-hosted.

## Is this only for macOS?

Server and signing are cross-platform, but full real device install support is currently macOS-first.

## Do you store Apple credentials remotely?

No remote relay is used. Secrets are stored locally and encrypted at rest.

## Free Apple ID or paid?

Both work. Free accounts have stricter app slot and expiry limits.

## How do updates work?

Desktop uses GitHub release artifacts and in-app updater checks.

## Can I install apps from the official SideLink source?

Yes. Add the official feed URL from [official-source](/official-source), then refresh your sources. The current public catalog includes the SideLink helper and Cortex.

## Can I use helper without desktop?

Helper pairs to a running SideLink server. Desktop is recommended for easiest setup.

## Why is the desktop release flow stricter now?

Because a successful build is not enough. Starting with the `v0.2.x` release hardening and carried forward through `v0.8.0`, SideLink validates packaged startup, bundled Apple runtime health, helper build integrity, and packaged helper behavior before publish so a clean CI build is not mistaken for a usable desktop release.

## Where do the docs publish?

When GitHub Pages is enabled for GitHub Actions, the docs site publishes to `https://gabrielvuksani.github.io/sidelink/`.

## Where does the official source manifest publish?

The canonical source manifest is the raw GitHub file:

`https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source/source.json`
