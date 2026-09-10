#!/bin/zsh
set -euo pipefail
app="${1:?Usage: sign-app.sh /path/to/application.app}"
# Sparkle ships signed nested helpers. Preserve their entitlements/signatures;
# seal the copied framework and outer app without recursively re-signing helpers.
framework="$app/Contents/Frameworks/Sparkle.framework"
if [[ -d "$framework" ]]; then
  codesign --force --sign - "$framework"
fi
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
