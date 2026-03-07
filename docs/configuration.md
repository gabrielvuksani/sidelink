# Configuration

This page covers the runtime knobs that matter for local operation, helper orchestration, and documentation publishing.

## Core Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `SIDELINK_PORT` | `4010` | Server port |
| `SIDELINK_DATA_DIR` | `tmp/desktop` (desktop mode) | Data directory for DB/state |
| `SIDELINK_CLIENT_DIR` | auto-detected | Built client path |
| `SIDELINK_MODE` | `demo` | Runtime mode |
| `SIDELINK_INTERNAL_TOKEN` | generated | Internal trusted token |

## Apple & Helper

| Variable | Purpose |
|---|---|
| `SIDELINK_TEAM_ID` | Preferred Apple team for helper build |
| `SIDELINK_HELPER_PROJECT_DIR` | Override helper project path |
| `SIDELINK_HELPER_SCHEME` | Override Xcode scheme |
| `SIDELINK_HELPER_TOKEN` | Static helper token fallback |

## Security

| Variable | Purpose |
|---|---|
| `SIDELINK_ENABLE_REAL_WORKER` | Enables real execution paths |
| `SIDELINK_ADMIN_USERNAME` | Initial admin bootstrap user for the manual `npm run db:bootstrap` flow |
| `SIDELINK_ADMIN_PASSWORD` | Initial admin bootstrap password for the manual `npm run db:bootstrap` flow |

## Data & Paths

- SQLite DB and cache are local-only.
- Uploaded IPAs live under the configured upload directory.
- Build artifacts are generated in `dist/` and `tmp/helper/`.

## GitHub Pages

The docs site is configured as a GitHub Pages project site.

- local preview uses `/`
- GitHub Actions builds use the repository sub-path automatically
- for this repository, the published URL is `https://gabrielvuksani.github.io/sidelink/`

::: tip Required repository setting
In GitHub repository Settings -> Pages, set `Build and deployment > Source` to `GitHub Actions`.
:::
