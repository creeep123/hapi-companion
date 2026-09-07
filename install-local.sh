#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
DERIVED="$ROOT/.build"
PRODUCT="$DERIVED/Build/Products/Release/HAPI Companion.app"
DEST="$HOME/Applications/HAPI Companion.app"
STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/hapi-companion-install.XXXXXX")"
STAGED="$STAGE_ROOT/HAPI Companion.app"
PREVIOUS="$STAGE_ROOT/previous.app"

cleanup() {
  rm -rf "$STAGE_ROOT"
}
trap cleanup EXIT

cd "$ROOT"
"$ROOT/scripts/doctor.sh"
"$ROOT/scripts/generate-brand-assets.sh"
xcodegen generate
xcodebuild \
  -project HapiCompanion.xcodeproj \
  -scheme HapiCompanion \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  build
codesign --force --deep --sign - "$PRODUCT"
codesign --verify --deep --strict "$PRODUCT"
# Copy into an empty staging directory. `ditto` merges into an existing bundle,
# which can leave obsolete executable files behind and invalidate its seal.
ditto "$PRODUCT" "$STAGED"
codesign --verify --deep --strict "$STAGED"
# Ad-hoc signatures have no stable designated requirement across rebuilds.
# Remove only this app's scoped device credential after a successful build so
# the replacement pairs automatically instead of triggering an ACL prompt.
security delete-generic-password -s io.github.creeep123.hapicompanion.device >/dev/null 2>&1 || true
mkdir -p "$HOME/Applications"

if pid="$(pgrep -x 'HAPI Companion' || true)" && [[ -n "$pid" ]]; then
  kill "$pid"
  sleep 1
fi
if [[ -e "$DEST" ]]; then
  mv "$DEST" "$PREVIOUS"
fi
if ! mv "$STAGED" "$DEST"; then
  [[ -e "$PREVIOUS" ]] && mv "$PREVIOUS" "$DEST"
  exit 1
fi
codesign --verify --deep --strict "$DEST"
open "$DEST"

echo "Installed: $DEST"
