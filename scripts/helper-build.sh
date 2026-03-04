#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_DIR="${SIDELINK_HELPER_PROJECT_DIR:-$ROOT_DIR/ios-helper/SidelinkHelper}"
PROJECT_FILE="$HELPER_DIR/SidelinkHelper.xcodeproj"
SCHEME="${SIDELINK_HELPER_SCHEME:-SidelinkHelper}"
DERIVED_DIR="$ROOT_DIR/tmp/helper/DerivedData"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "[sidelink-helper] xcodebuild not found. Install full Xcode, then run again." >&2
  exit 2
fi

if [[ ! -d "$PROJECT_FILE" ]]; then
  if command -v xcodegen >/dev/null 2>&1 && [[ -f "$HELPER_DIR/project.yml" ]]; then
    echo "[sidelink-helper] Generating Xcode project via xcodegen..."
    (cd "$HELPER_DIR" && xcodegen generate)
  else
    echo "[sidelink-helper] Missing $PROJECT_FILE" >&2
    echo "[sidelink-helper] Install xcodegen and run: (cd ios-helper/SidelinkHelper && xcodegen generate)" >&2
    exit 3
  fi
fi

echo "[sidelink-helper] Building helper app..."
xcodebuild \
  -project "$PROJECT_FILE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$DERIVED_DIR" \
  build

echo "[sidelink-helper] Build complete. Run scripts/helper-export.sh to produce IPA."