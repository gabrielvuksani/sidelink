# Sidelink

Cross-platform iOS sideload manager with a web control center, Electron desktop shell, TypeScript signing pipeline, AltStore-compatible sources, and an optional iPhone helper app.

## Quick Start

```bash
git clone https://github.com/gabrielvuksani/sidelink.git
cd sidelink
npm install
npm run dev
```

`npm install` automatically creates `.venv`, installs the required Python packages, and checks platform prerequisites. Open `http://localhost:4010` and complete the setup wizard.

If you want the full bootstrap and validation pass in one command:

```bash
npm run setup
```

## Highlights

- Desktop dashboard for Apple accounts, devices, installs, logs, and sources
- Automatic Python environment bootstrap on install
- Cross-platform build and packaging flow for macOS, Windows, and Linux
- Optional iOS helper app with pairing code flow and background refresh support
- VitePress documentation site and GitHub Actions release/docs pipelines

## Documentation

Core docs live in `docs/`.

- `docs/getting-started.md`
- `docs/desktop-app.md`
- `docs/ios-helper.md`
- `docs/troubleshooting.md`
- `docs/cli-reference.md`
- `docs/api-reference.md`

Preview locally with:

```bash
npm run docs:dev
```

## Core Commands

```bash
npm run setup
npm run verify
npm run doctor
npm run desktop:easy
```

## Release

```bash
bash scripts/release.sh v0.1.0 --dry-run
```

When ready to cut the tag for real:

```bash
bash scripts/release.sh v0.1.0
git push origin main --tags
```

## License

MIT
