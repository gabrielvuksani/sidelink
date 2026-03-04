#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_DIR="${SIDELINK_HELPER_PROJECT_DIR:-$ROOT_DIR/ios-helper/SidelinkHelper}"
PROJECT_FILE="$HELPER_DIR/SidelinkHelper.xcodeproj"
SCHEME="${SIDELINK_HELPER_SCHEME:-SidelinkHelper}"
ARCHIVE_PATH="$ROOT_DIR/tmp/helper/SidelinkHelper.xcarchive"
EXPORT_DIR="$ROOT_DIR/tmp/helper/export"
EXPORT_OPTIONS_PLIST="${SIDELINK_HELPER_EXPORT_OPTIONS_PLIST:-$HELPER_DIR/ExportOptions.plist}"
OUTPUT_IPA="${SIDELINK_HELPER_IPA_PATH:-$ROOT_DIR/tmp/helper/SidelinkHelper.ipa}"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "[sidelink-helper] xcodebuild not found. Install full Xcode to export IPA." >&2
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

if [[ ! -f "$EXPORT_OPTIONS_PLIST" ]]; then
  echo "[sidelink-helper] Missing export options plist at $EXPORT_OPTIONS_PLIST" >&2
  exit 4
fi

mkdir -p "$ROOT_DIR/tmp/helper" "$EXPORT_DIR"

echo "[sidelink-helper] Archiving helper app..."
xcodebuild \
  -project "$PROJECT_FILE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  archive

echo "[sidelink-helper] Exporting IPA..."
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PLIST"

IPA_CANDIDATE="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' | head -n 1 || true)"
if [[ -z "$IPA_CANDIDATE" ]]; then
  echo "[sidelink-helper] Export completed but no IPA file was generated." >&2
  exit 5
fi

mkdir -p "$(dirname "$OUTPUT_IPA")"
cp "$IPA_CANDIDATE" "$OUTPUT_IPA"

echo "[sidelink-helper] IPA ready at: $OUTPUT_IPA"