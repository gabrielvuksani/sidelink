#!/usr/bin/env bash
# ─── Release Script ───────────────────────────────────────────────────
# Usage:  bash scripts/release.sh v1.2.3 [--dry-run]
#
# Bumps package.json version, creates a git commit + tag, and (optionally)
# pushes. The version argument must be full semver and start with 'v' (e.g., v0.2.0).
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

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must match v<MAJOR>.<MINOR>.<PATCH>"
  echo "  Example: v0.2.0"
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

if git remote get-url origin >/dev/null 2>&1; then
  echo "[release] Fetching origin to verify main is in sync ..."
  git fetch --tags origin main >/dev/null 2>&1 || {
    echo "Error: Could not fetch origin/main. Check network access and retry."
    exit 1
  }

  LOCAL_HEAD="$(git rev-parse HEAD)"
  REMOTE_MAIN="$(git rev-parse origin/main)"
  if [[ "$LOCAL_HEAD" != "$REMOTE_MAIN" ]]; then
    echo "Error: Local main is not aligned with origin/main."
    echo "  Local : $LOCAL_HEAD"
    echo "  Remote: $REMOTE_MAIN"
    echo "  Pull/rebase first, then create the release tag from the exact main tip you want to publish."
    exit 1
  fi
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

# ── Pre-release checks ────────────────────────────────────────────────

# Ensure CHANGELOG.md has an entry for this version
if ! grep -q "\[$VERSION\]" CHANGELOG.md; then
  echo "Error: CHANGELOG.md has no entry for [$VERSION]."
  echo "  Add a section like: ## [$VERSION] - $(date +%Y-%m-%d)"
  exit 1
fi

# Version monotonicity: new version must be >= current
LATEST_TAG="$(git tag -l 'v*' --sort=-v:refname | head -1 || true)"
if [[ -n "$LATEST_TAG" ]]; then
  LATEST_VERSION="${LATEST_TAG#v}"
  HIGHER="$(printf '%s\n%s' "$LATEST_VERSION" "$VERSION" | sort -V | tail -1)"
  if [[ "$HIGHER" != "$VERSION" && "$LATEST_VERSION" != "$VERSION" ]]; then
    echo "Error: Target version $VERSION is older than latest tag $LATEST_TAG."
    exit 1
  fi
fi

# ── Bump ──────────────────────────────────────────────────────────────

echo "[release] Preparing release $TAG ..."
echo "[release] Tip: run npm run verify before tagging, and npm run desktop:smoke if you packaged the mac app locally."

RELEASE_HELPER_DIR="$ROOT_DIR/helper"
RELEASE_HELPER_IPA="$RELEASE_HELPER_DIR/SidelinkHelper.ipa"
LOCAL_HELPER_IPA="$ROOT_DIR/tmp/helper/SidelinkHelper.ipa"

if [[ -f "$LOCAL_HELPER_IPA" ]]; then
  mkdir -p "$RELEASE_HELPER_DIR"
  cp "$LOCAL_HELPER_IPA" "$RELEASE_HELPER_IPA"
  echo "[release] Prepared release helper IPA from tmp/helper/SidelinkHelper.ipa"
elif [[ -f "$RELEASE_HELPER_IPA" ]]; then
  echo "[release] Using existing tracked helper IPA at helper/SidelinkHelper.ipa"
else
  echo "Error: Missing helper IPA for release publishing."
  echo "  Expected one of:"
  echo "    - tmp/helper/SidelinkHelper.ipa"
  echo "    - helper/SidelinkHelper.ipa"
  echo "  Run npm run helper:export on macOS first, or place the IPA at helper/SidelinkHelper.ipa before tagging."
  exit 1
fi

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
  echo "[release] Would run: git add package.json helper/SidelinkHelper.ipa"
  echo "[release] Would run: git commit -m '$TAG'"
  echo "[release] Would run: git tag -a '$TAG' -m 'Release $TAG'"
else
  if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "Error: Tag $TAG already exists locally."
    exit 1
  fi
  if git ls-remote --tags origin "refs/tags/$TAG" | grep -q "$TAG"; then
    echo "Error: Tag $TAG already exists on origin. Published release tags are immutable."
    echo "  Create a new semver tag instead of moving an existing release tag."
    exit 1
  fi
  git add package.json helper/SidelinkHelper.ipa
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
echo "  Do not force-move a published release tag."
echo "  If release automation needs follow-up fixes, commit them to main and ship them in the next version."
echo ""
