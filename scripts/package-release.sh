#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
VERSION="${1:-0.1.0}"
# A release must not inherit removed resources or debug leftovers from local builds.
DERIVED="$(mktemp -d "${TMPDIR:-/tmp}/hapi-companion-release.XXXXXX")"
trap 'rm -rf "$DERIVED"' EXIT
APP="$DERIVED/Build/Products/Release/HAPI Companion.app"
DIST="$ROOT/dist/v$VERSION"

cd "$ROOT"
./scripts/generate-brand-assets.sh
xcodegen generate
xcodebuild \
  -project HapiCompanion.xcodeproj \
  -scheme HapiCompanion \
  -destination 'platform=macOS' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO test
xcodebuild \
  -project HapiCompanion.xcodeproj \
  -scheme HapiCompanion \
  -configuration Release \
  -destination 'platform=macOS' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO build

actual_version="$(defaults read "$APP/Contents/Info" CFBundleShortVersionString)"
[[ "$actual_version" == "$VERSION" ]] || { echo "Version mismatch: project=$actual_version requested=$VERSION" >&2; exit 1; }

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

mkdir -p "$DIST"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$DIST/HAPI-Companion-v$VERSION-macOS-ad-hoc.zip"
ditto -c -k --sequesterRsrc --keepParent "$ROOT/brand" "$DIST/HAPI-Companion-v$VERSION-brand-assets.zip"
cp "$ROOT/integrations/hapi/hapi-companion.patch" "$DIST/HAPI-Companion-v$VERSION-HAPI-0.29.0.patch"
(
  cd "$DIST"
  shasum -a 256 HAPI-Companion-v$VERSION-* > SHA256SUMS.txt
)

echo "Release payload ready at $DIST"
echo "Note: the app is ad-hoc signed and not notarized; source installation remains recommended."
