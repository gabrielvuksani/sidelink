#!/usr/bin/env bash
# ─── Release Script ───────────────────────────────────────────────────
# Usage:  bash scripts/release.sh v1.2.3 [--dry-run]
#
# Bumps package.json version, creates a git commit + tag, and (optionally)
# pushes.  The version argument must start with 'v' (e.g., v0.0.1, v1.5).
#
# What it does:
#   1. Validates the version string
#   2. Updates "version" in package.json
#   3. Stages package.json
#   4. Commits as "v<VERSION>"
#   5. Tags as "v<VERSION>"
#   6. Prints push instructions (does NOT push automatically)
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/release.sh v<VERSION> [--dry-run]"
  echo "Example: bash scripts/release.sh v1.2.0 --dry-run"
  exit 1
fi

TAG="$1"
DRY_RUN="${2:-}"

# ── Validate ──────────────────────────────────────────────────────────

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
  echo "Error: Version must match v<MAJOR>.<MINOR>[.<PATCH>]"
  echo "  Examples: v0.0.1, v1.5, v2.0.0"
  exit 1
fi

VERSION="${TAG#v}"  # strip leading 'v'

# Ensure we're in the repo root (where package.json lives)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Check for clean working tree (allow staged changes only in package.json)
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "Error: Working tree has uncommitted changes. Commit or stash first."
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "Error: Releases must be created from 'main' (current: $CURRENT_BRANCH)."
  exit 1
fi

CURRENT_VERSION="$(node -p "require('./package.json').version")"

echo "[release] Current package.json version: $CURRENT_VERSION"
echo "[release] Target version: $VERSION"

if [[ "$CURRENT_VERSION" == "$VERSION" ]]; then
  echo "[release] package.json already matches requested version."
fi

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "[release] Dry run mode enabled."
fi

# ── Bump ──────────────────────────────────────────────────────────────

echo "[release] Preparing release $TAG ..."

# Use node to safely update package.json without mangling formatting
if [[ "$CURRENT_VERSION" != "$VERSION" ]]; then
  echo "[release] Bumping package.json version to $VERSION ..."
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
fi

# ── Commit + Tag ──────────────────────────────────────────────────────

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "[release] Would run: git add package.json"
  echo "[release] Would run: git commit -m '$TAG'"
  echo "[release] Would run: git tag -a '$TAG' -m 'Release $TAG'"
else
  if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "Error: Tag $TAG already exists locally."
    exit 1
  fi
  git add package.json
  git commit -m "$TAG"
  git tag -a "$TAG" -m "Release $TAG"
fi

echo ""
if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "[release] Dry run complete for: $TAG"
else
  echo "[release] Created commit and tag: $TAG"
fi
echo ""
echo "  To push:  git push origin main --tags"
echo "  electron-builder will pick up the tag when you"
echo "  run:  npm run desktop:package"
echo ""
