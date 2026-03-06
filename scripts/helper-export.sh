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
DEFAULT_HELPER_BUNDLE_ID="com.sidelink.helper"
HELPER_BUNDLE_ID="${SIDELINK_HELPER_BUNDLE_ID:-$DEFAULT_HELPER_BUNDLE_ID}"
BUNDLE_ID_WAS_EXPLICIT=0
if [[ -n "${SIDELINK_HELPER_BUNDLE_ID:-}" ]]; then
  BUNDLE_ID_WAS_EXPLICIT=1
fi

detect_team_id_from_signing_identity() {
  if ! command -v security >/dev/null 2>&1; then
    return 0
  fi
  local team
  team="$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -nE 's/.*Apple Development:.*\(([A-Z0-9]{10})\).*/\1/p' \
    | awk '{ count[$1]++ } END { for (k in count) print count[k], k }' \
    | sort -rn \
    | head -n1 \
    | awk '{ print $2 }')"
  if [[ -n "$team" ]]; then
    printf '%s' "$team"
  fi
}

detect_team_id_from_xcode_preferences() {
  if ! command -v defaults >/dev/null 2>&1; then
    return 0
  fi

  local team
  team="$(defaults read com.apple.dt.Xcode IDEProvisioningTeamManagerLastSelectedTeamID 2>/dev/null || true)"
  team="$(printf '%s' "$team" | tr -d '[:space:]')"

  if [[ -z "$team" ]]; then
    team="$(defaults read com.apple.dt.Xcode IDEProvisioningTeam 2>/dev/null || true)"
    team="$(printf '%s' "$team" | tr -d '[:space:]')"
  fi

  if [[ "$team" =~ ^[A-Z0-9]{10}$ ]]; then
    printf '%s' "$team"
  fi
}

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "[sidelink-helper] xcodebuild not found. Install full Xcode to export IPA." >&2
  exit 2
fi

if command -v xcodegen >/dev/null 2>&1 && [[ -f "$HELPER_DIR/project.yml" ]]; then
  echo "[sidelink-helper] Regenerating Xcode project via xcodegen..."
  (cd "$HELPER_DIR" && xcodegen generate)
fi

if [[ ! -d "$PROJECT_FILE" ]]; then
  echo "[sidelink-helper] Missing $PROJECT_FILE" >&2
  echo "[sidelink-helper] Install xcodegen and run: (cd ios-helper/SidelinkHelper && xcodegen generate)" >&2
  exit 3
fi

if [[ ! -f "$EXPORT_OPTIONS_PLIST" ]]; then
  echo "[sidelink-helper] Missing export options plist at $EXPORT_OPTIONS_PLIST" >&2
  exit 4
fi

mkdir -p "$ROOT_DIR/tmp/helper" "$EXPORT_DIR"

if [[ -z "${SIDELINK_TEAM_ID:-}" ]]; then
  AUTO_TEAM_ID="$(detect_team_id_from_xcode_preferences)"
  if [[ -n "$AUTO_TEAM_ID" ]]; then
    export SIDELINK_TEAM_ID="$AUTO_TEAM_ID"
    echo "[sidelink-helper] Auto-detected Team ID from Xcode settings: $SIDELINK_TEAM_ID"
  else
    AUTO_TEAM_ID="$(detect_team_id_from_signing_identity)"
    if [[ -n "$AUTO_TEAM_ID" ]]; then
      export SIDELINK_TEAM_ID="$AUTO_TEAM_ID"
      echo "[sidelink-helper] Auto-detected Team ID from signing identity: $SIDELINK_TEAM_ID"
      echo "[sidelink-helper] If export fails with 'No Account for Team', set SIDELINK_TEAM_ID from Xcode Settings > Accounts."
    else
      echo "[sidelink-helper] Warning: SIDELINK_TEAM_ID not set. Automatic signing may fail."
      echo "[sidelink-helper] Set it with: export SIDELINK_TEAM_ID=<your 10-char Team ID>"
    fi
  fi
fi

echo "[sidelink-helper] Archiving helper app..."
echo "[sidelink-helper] Using bundle identifier: $HELPER_BUNDLE_ID"

run_archive() {
  local bundle_id="$1"
  xcodebuild \
    -project "$PROJECT_FILE" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE_PATH" \
    -allowProvisioningUpdates \
    PRODUCT_BUNDLE_IDENTIFIER="$bundle_id" \
    archive
}

ARCHIVE_LOG="$(mktemp -t sidelink-helper-archive.XXXXXX.log)"
set +e
run_archive "$HELPER_BUNDLE_ID" 2>&1 | tee "$ARCHIVE_LOG"
ARCHIVE_STATUS=${PIPESTATUS[0]}
set -e

if [[ $ARCHIVE_STATUS -ne 0 && $BUNDLE_ID_WAS_EXPLICIT -eq 0 ]] \
  && grep -q "cannot be registered to your development team because it is not available" "$ARCHIVE_LOG"; then
  if [[ -n "${SIDELINK_TEAM_ID:-}" ]]; then
    FALLBACK_BUNDLE_ID="${DEFAULT_HELPER_BUNDLE_ID}.$(printf '%s' "$SIDELINK_TEAM_ID" | tr '[:upper:]' '[:lower:]')"
    if [[ "$FALLBACK_BUNDLE_ID" != "$HELPER_BUNDLE_ID" ]]; then
      echo "[sidelink-helper] Bundle identifier $HELPER_BUNDLE_ID is unavailable for this team."
      echo "[sidelink-helper] Retrying archive with team-scoped bundle identifier: $FALLBACK_BUNDLE_ID"
      set +e
      run_archive "$FALLBACK_BUNDLE_ID"
      ARCHIVE_STATUS=$?
      set -e
    fi
  fi
fi

if [[ $ARCHIVE_STATUS -ne 0 ]]; then
  exit $ARCHIVE_STATUS
fi

echo "[sidelink-helper] Exporting IPA..."
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PLIST" \
  -allowProvisioningUpdates

IPA_CANDIDATE="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' | head -n 1 || true)"
if [[ -z "$IPA_CANDIDATE" ]]; then
  echo "[sidelink-helper] Export completed but no IPA file was generated." >&2
  exit 5
fi

mkdir -p "$(dirname "$OUTPUT_IPA")"
cp "$IPA_CANDIDATE" "$OUTPUT_IPA"

echo "[sidelink-helper] IPA ready at: $OUTPUT_IPA"