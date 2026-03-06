# Getting Started

This guide follows the same practical structure as AltStore docs: prerequisites first, then numbered install steps, then validation.

## Requirements

- macOS 11+ for full device install support
- Node.js 20+
- Python 3.10+
- Apple ID (free or paid)

## Quick Start

```bash
git clone https://github.com/gabrielvuksani/sidelink.git
cd sidelink
npm install
npm run dev
```

`npm install` automatically creates the local Python environment, installs the required helper packages, and runs dependency preflight checks.

Open `http://localhost:4010`.

If you want a single command that bootstraps and validates everything:

```bash
npm run setup
```

## Full Install Steps

1. Install dependencies (`node`, `python`, and `xcodegen` on macOS when building the helper locally).
2. Run `npm install`.
3. Let postinstall finish creating `.venv`, installing Python packages, and checking USB prerequisites.
4. Connect your iPhone over USB and trust the computer.
5. Run `npm run dev`.
6. Complete Setup Wizard: admin, Apple ID, device, IPA upload.
7. Install apps from the Install, Apps, or Sources flows.

## Validate Setup

```bash
npm run verify
```

## Next

- [Desktop App](/desktop-app)
- [iOS Helper](/ios-helper)
- [Troubleshooting](/troubleshooting)
