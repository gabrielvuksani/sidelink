#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_DIR="${SIDELINK_HELPER_PROJECT_DIR:-$ROOT_DIR/ios-helper/SidelinkHelper}"
PROJECT_FILE="$HELPER_DIR/SidelinkHelper.xcodeproj"
SCHEME="${SIDELINK_HELPER_SCHEME:-SidelinkHelper}"
DERIVED_DIR="$ROOT_DIR/tmp/helper/DerivedData"
DEFAULT_HELPER_BUNDLE_ID="com.sidelink.ioshelper"
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
  echo "[sidelink-helper] xcodebuild not found. Install full Xcode, then run again." >&2
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

# If SIDELINK_TEAM_ID isn't set, try to read from Xcode's default team
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
      echo "[sidelink-helper] If build fails with 'No Account for Team', set SIDELINK_TEAM_ID from Xcode Settings > Accounts."
    else
      echo "[sidelink-helper] Warning: SIDELINK_TEAM_ID not set."
      echo "[sidelink-helper] Set it with: export SIDELINK_TEAM_ID=<your 10-char Team ID>"
      echo "[sidelink-helper] Free Apple ID team ID is visible in Xcode Settings > Accounts."
    fi
  fi
fi

echo "[sidelink-helper] Building helper app..."
echo "[sidelink-helper] Using bundle identifier: $HELPER_BUNDLE_ID"

run_build() {
  local bundle_id="$1"
  xcodebuild \
    -project "$PROJECT_FILE" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination "generic/platform=iOS" \
    -derivedDataPath "$DERIVED_DIR" \
    -allowProvisioningUpdates \
    PRODUCT_BUNDLE_IDENTIFIER="$bundle_id" \
    build
}

BUILD_LOG="$(mktemp -t sidelink-helper-build.XXXXXX.log)"
set +e
run_build "$HELPER_BUNDLE_ID" 2>&1 | tee "$BUILD_LOG"
BUILD_STATUS=${PIPESTATUS[0]}
set -e

if [[ $BUILD_STATUS -ne 0 && $BUNDLE_ID_WAS_EXPLICIT -eq 0 ]] \
  && grep -q "cannot be registered to your development team because it is not available" "$BUILD_LOG"; then
  if [[ -n "${SIDELINK_TEAM_ID:-}" ]]; then
    FALLBACK_BUNDLE_ID="${DEFAULT_HELPER_BUNDLE_ID}.$(printf '%s' "$SIDELINK_TEAM_ID" | tr '[:upper:]' '[:lower:]')"
    if [[ "$FALLBACK_BUNDLE_ID" != "$HELPER_BUNDLE_ID" ]]; then
      echo "[sidelink-helper] Bundle identifier $HELPER_BUNDLE_ID is unavailable for this team."
      echo "[sidelink-helper] Retrying with team-scoped bundle identifier: $FALLBACK_BUNDLE_ID"
      set +e
      run_build "$FALLBACK_BUNDLE_ID"
      BUILD_STATUS=$?
      set -e
    fi
  fi
fi

if [[ $BUILD_STATUS -ne 0 ]]; then
  exit $BUILD_STATUS
fi

echo "[sidelink-helper] Build complete. Run scripts/helper-export.sh to produce IPA."