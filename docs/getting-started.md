# Getting Started

Use this page if you want the shortest reliable path from install to a real SideLink session.

## Who This Page Is For

- New users who want to run SideLink locally
- Operators who want the fastest verified setup path
- Anyone who needs to understand the order: admin bootstrap, Apple ID, device, IPA or source, then install

## What You Need

| Requirement | Why it matters |
| --- | --- |
| Node.js 20+ | Builds the server, desktop shell, web client, and docs |
| Python 3.10+ | Powers helper scripts, Apple tooling, and device commands |
| macOS 11+ | Gives you the most complete real-device and local helper build path |
| Apple ID | Required for real signing and provisioning |
| iPhone or iPad | Required for real installs and helper pairing |

## Fastest Local Start

```bash
git clone https://github.com/gabrielvuksani/sidelink.git
cd sidelink
npm install
npm run desktop:easy
```

Use `npm run desktop:easy` if you want the closest thing to the real product loop.

If you only want the backend and browser UI:

```bash
npm run dev
```

Then open `http://localhost:4010`.

## First-Run Checklist

1. Create the local admin account.
2. Add and verify an Apple ID.
3. Connect a device or refresh device discovery.
4. Upload an IPA or add a source feed.
5. Start the install from Overview, Apps, Sources, or the helper.

::: tip No default login
SideLink does not ship seeded admin credentials. The first run creates the admin account directly in the setup flow.
:::

## The First Product Loop

If you want the shortest path to proving the stack works, use this exact order:

1. Launch SideLink.
2. Finish admin setup.
3. Open Apple ID settings and sign in.
4. Go to Devices and refresh until your iPhone appears.
5. Upload one IPA or add the official source.
6. Start an install.
7. If Apple requests verification, finish 2FA in the install flow or the helper.

## Add The Official Source

If you want SideLink apps to show up as a source instead of importing IPAs manually, use the public feed:

`https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source/source.json`

That feed currently includes:

- SideLink Helper
- Cortex

Full instructions live on [official-source](/official-source).

## Pair The iPhone Helper

The iPhone helper is optional, but it is the fastest way to follow installs, submit 2FA, and check refresh state away from the desktop.

Current pairing flow:

1. Open the desktop helper pairing card.
2. Copy the 6-digit code.
3. Open the helper on iPhone.
4. Grant the requested permissions.
5. Enter the code manually.
6. Use QR only if camera handoff is faster.

Full helper guidance lives on [ios-helper](/ios-helper).

## Validate Your Setup

Use the full verification path before packaging or releasing:

```bash
npm run verify
```

`npm run verify` runs:

- TypeScript checks
- Vitest test suite
- Official source regeneration
- Production build
- Docs build
- Runtime doctor checks

## Useful Commands

| Command | When to use it |
| --- | --- |
| `npm run desktop:easy` | Fastest local desktop launch |
| `npm run dev` | Run the server and browser UI without Electron |
| `npm run verify` | Validate the full repo before release or major changes |
| `npm run source:generate` | Regenerate the official source feed after adding IPAs |
| `npm run helper:export` | Export the iPhone helper IPA on macOS |

## Where To Go Next

- Want the desktop workflow: [desktop-app](/desktop-app)
- Want the helper workflow: [ios-helper](/ios-helper)
- Want the public source and download links: [official-source](/official-source)
- Need runtime and env settings: [configuration](/configuration)
- Need recovery steps: [troubleshooting](/troubleshooting)
