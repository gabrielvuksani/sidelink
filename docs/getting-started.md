# Getting Started

Use this page when you want the shortest reliable path from clone to first working SideLink install flow.

## Requirements

| Requirement | Why it matters |
| --- | --- |
| Node.js 20+ | Builds the server, desktop shell, and web client |
| Python 3.10+ | Powers helper scripts and Apple/device tooling |
| macOS 11+ | Gives you the most complete local device install and helper build path |
| Apple ID | Required for real signing and provisioning |

## Quick Start

```bash
git clone https://github.com/gabrielvuksani/sidelink.git
cd sidelink
npm install
npm run dev
```

Open `http://localhost:4010`.

`npm install` already prepares the local Python environment, installs helper dependencies, and runs preflight checks.

::: tip First-run auth
SideLink now asks you to create the admin account during setup. There is no shipped default username or password.
:::

## First-Run Sequence

1. Create the admin account.
2. Add and verify an Apple ID.
3. Connect or discover a device.
4. Upload an IPA or add a source.
5. Start the first install from the dashboard, library, or source flow.

## One-Command Bootstrap

```bash
npm run setup
```

Use this when you want dependency install plus a full validation pass.

## Validate Setup

```bash
npm run verify
```

`verify` runs type checks, tests, production builds, docs build, and doctor diagnostics.

## Continue With

- [Desktop App](/desktop-app)
- [Configuration](/configuration)
- [Troubleshooting](/troubleshooting)
