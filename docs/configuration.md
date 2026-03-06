# Configuration

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
| `SIDELINK_ADMIN_USERNAME` | Initial admin bootstrap user |
| `SIDELINK_ADMIN_PASSWORD` | Initial admin bootstrap password |

## Data & Paths

- SQLite DB and cache are local-only.
- Uploaded IPAs live under the configured upload directory.
- Build artifacts are generated in `dist/` and `tmp/helper/`.
