#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
DERIVED="$ROOT/.build"
PRODUCT="$DERIVED/Build/Products/Release/HAPI Companion.app"
DEST="$HOME/Applications/HAPI Companion.app"

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
# Ad-hoc signatures have no stable designated requirement across rebuilds.
# Remove only this app's scoped device credential after a successful build so
# the replacement pairs automatically instead of triggering an ACL prompt.
security delete-generic-password -s io.github.creeep123.hapicompanion.device >/dev/null 2>&1 || true
mkdir -p "$HOME/Applications"
ditto "$PRODUCT" "$DEST"

if pid="$(pgrep -x 'HAPI Companion' || true)" && [[ -n "$pid" ]]; then
  kill "$pid"
  sleep 1
fi
open "$DEST"

echo "Installed: $DEST"
