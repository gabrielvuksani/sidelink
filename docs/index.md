---
layout: home

hero:
  name: SideLink
  text: The full SideLink guide for setup, installs, helper pairing, and source downloads
  tagline: "Everything a first-time user, operator, or maintainer needs: desktop setup, iPhone helper pairing, IPA installs, official source downloads, troubleshooting, and release operations."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Official Source
      link: /official-source
    - theme: alt
      text: GitHub
      link: https://github.com/gabrielvuksani/sidelink

features:
  - title: A real first-run path
    details: "Start from clone or from a release download and move cleanly into Apple sign-in, device detection, helper pairing, source setup, and your first install."
  - title: Official source included
    details: "The docs now explain the public source feed, direct IPA download links, and how SideLink publishes helper and app assets through GitHub Releases."
  - title: User guidance plus operator detail
    details: "The same site explains what to click, what to run, what to expect, and how to recover when device, Apple, packaging, or source flows go wrong."
---

## Start Here

Choose the shortest path that matches what you are trying to do.

<div class="sl-doc-card-grid">
	<div class="sl-doc-card">
		<h3>Set Up SideLink</h3>
		<p>Use <a href="/getting-started">Getting Started</a> if you want the fastest route from install to your first real device install.</p>
	</div>
	<div class="sl-doc-card">
		<h3>Use The Desktop App</h3>
		<p>Use <a href="/desktop-app">Desktop App</a> to understand the overview, install center, devices, Apple IDs, sources, packaging, and updates.</p>
	</div>
	<div class="sl-doc-card">
		<h3>Pair The iPhone Helper</h3>
		<p>Use <a href="/ios-helper">iOS Helper</a> for permissions, code-first pairing, on-device source browsing, installs, and refresh visibility.</p>
	</div>
	<div class="sl-doc-card">
		<h3>Download From The Official Source</h3>
		<p>Use <a href="/official-source">Official Source</a> for the public feed URL, direct IPA downloads, and the current app catalog including Cortex.</p>
	</div>
</div>

## What You Can Find Here

- The exact steps to run SideLink locally or use a published release
- How the desktop app, web control center, backend, and iPhone helper fit together
- How to add the official source feed and download published IPAs
- Release-safe packaging, validation, and publishing guidance for `v0.8.0`
- Troubleshooting for Apple sign-in, device discovery, helper pairing, source installs, and packaging

## Quick Links

- New here: [getting-started](/getting-started)
- Want the public source feed: [official-source](/official-source)
- Using the desktop shell: [desktop-app](/desktop-app)
- Using the iPhone helper: [ios-helper](/ios-helper)
- Need commands: [cli-reference](/cli-reference)
- Need recovery steps: [troubleshooting](/troubleshooting)

## What SideLink Ships

| Surface | What it gives you |
| --- | --- |
| Desktop app | Local Electron shell, tray integration, auto-update support, packaged releases |
| Web control center | Overview, installs, devices, Apple IDs, sources, logs, scheduler state |
| Signing backend | IPA ingestion, provisioning, install jobs, retries, 2FA pauses, refresh logic |
| iPhone helper | Code-first pairing, source browsing, installs, 2FA entry, refresh monitoring |
| Official source | Release-hosted IPAs, public source manifest, direct download links |

## Current Public Distribution

The official SideLink source feed is published from the repository and points at GitHub Release assets.

- Source page: [official-source](/official-source)
- Feed URL: `https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source/source.json`
- Releases: `https://github.com/gabrielvuksani/sidelink/releases`

That source currently includes the SideLink helper and your first public app listing, Cortex.
