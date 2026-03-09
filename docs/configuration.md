# Configuration

This page covers the settings, paths, and environment variables that matter for running SideLink locally, building the helper, publishing docs, and shipping releases.

## Core Runtime Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIDELINK_PORT` | `4010` | HTTP port for the backend and control center |
| `SIDELINK_DATA_DIR` | `tmp/desktop` in desktop mode | Local database, sessions, uploads, and runtime state |
| `SIDELINK_CLIENT_DIR` | auto-detected | Built client path when serving production assets |
| `SIDELINK_MODE` | `demo` | Runtime mode used by server startup |
| `SIDELINK_INTERNAL_TOKEN` | generated when needed | Internal trusted token used by desktop-side flows |

## Apple And Helper Variables

| Variable | Purpose |
| --- | --- |
| `SIDELINK_TEAM_ID` | Preferred Apple team for helper build/export |
| `SIDELINK_HELPER_PROJECT_DIR` | Override the helper project directory |
| `SIDELINK_HELPER_SCHEME` | Override the Xcode scheme used for helper builds |
| `SIDELINK_HELPER_TOKEN` | Static helper token fallback if needed |

## Security And Bootstrap

| Variable | Purpose |
| --- | --- |
| `SIDELINK_ENABLE_REAL_WORKER` | Enables real execution paths instead of demo-only behavior |
| `SIDELINK_ADMIN_USERNAME` | Bootstrap username for the manual `npm run db:bootstrap` flow |
| `SIDELINK_ADMIN_PASSWORD` | Bootstrap password for the manual `npm run db:bootstrap` flow |

## Important Paths

| Path | What it is for |
| --- | --- |
| `tmp/desktop/` | Local database, uploads, sessions, and runtime data during development |
| `tmp/helper/` | Exported helper IPA output |
| `helper/` | Tracked helper IPA used for release publishing |
| `docs/source/apps/` | Public app drop zone for the official source feed |
| `docs/source/source.json` | Canonical generated source manifest |
| `docs/source.json` | Copy of the generated source manifest at the docs root |

## Official Source Configuration

The official source feed is generated from `docs/source/apps/`.

Important rules:

1. Drop each `.ipa` into `docs/source/apps/`.
2. Add an optional same-name JSON override for human-friendly metadata.
3. Run `npm run source:generate`.
4. Tag and release.
5. GitHub Actions uploads every IPA in `docs/source/apps/` as release assets.

Canonical feed URL:

`https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source/source.json`

## Docs Publishing

The docs site is a GitHub Pages project site.

- local preview uses `/`
- GitHub Actions builds use the repository sub-path automatically
- published URL: `https://gabrielvuksani.github.io/sidelink/`

::: tip Required repository setting
In GitHub repository Settings -> Pages, set `Build and deployment > Source` to `GitHub Actions`.
:::

## Helper Project Notes

The helper Xcode project is generated from:

- `ios-helper/SidelinkHelper/project.yml`

If you add Swift files and Xcode does not see them, regenerate the project before assuming the code is broken.
