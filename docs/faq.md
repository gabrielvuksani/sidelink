# FAQ

## Does Sidelink require AltServer?

No. Sidelink is local-first and self-hosted.

## Is this only for macOS?

Server and signing are cross-platform, but full real device install support is currently macOS-first.

## Do you store Apple credentials remotely?

No remote relay is used. Secrets are stored locally and encrypted at rest.

## Free Apple ID or paid?

Both work. Free accounts have stricter app slot and expiry limits.

## How do updates work?

Desktop uses GitHub release artifacts and in-app updater checks.

## Can I use helper without desktop?

Helper pairs to a running Sidelink server. Desktop is recommended for easiest setup.

## Why is the desktop release flow stricter now?

Because a successful build is not enough. `v0.2.0` adds a packaged startup smoke test so broken DMG installs are caught before release publication.

## Where do the docs publish?

When GitHub Pages is enabled for GitHub Actions, the docs site publishes to `https://gabrielvuksani.github.io/sidelink/`.
