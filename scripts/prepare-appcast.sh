#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
VERSION="${1:?Usage: prepare-appcast.sh VERSION SPARKLE_BIN_DIRECTORY}"
BIN="${2:?Supply Sparkle 2.9.6 bin directory}"
DIST="$ROOT/dist/v$VERSION"
ARCHIVE="HAPI-Companion-v$VERSION-macOS-ad-hoc.zip"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/companion-appcast.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp "$DIST/$ARCHIVE" "$STAGE/"
if [[ -f "$ROOT/updates/appcast.xml" ]]; then
  cp "$ROOT/updates/appcast.xml" "$STAGE/appcast.xml"
fi
"$BIN/generate_appcast" --account io.github.creeep123.hapicompanion.updates   --maximum-deltas 0   --download-url-prefix "https://github.com/creeep123/hapi-companion/releases/download/v$VERSION/"   "$STAGE"
"$BIN/sign_update" --account io.github.creeep123.hapicompanion.updates --verify "$STAGE/appcast.xml"
cp "$STAGE/appcast.xml" "$DIST/appcast.xml"
echo "Signed appcast staged at $DIST/appcast.xml; publish only after release assets are public and verified."
