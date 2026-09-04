#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
APP_SVG="$ROOT/brand/app-icon/signal-buddy-app-icon.svg"
SMALL_APP_SVG="$ROOT/brand/app-icon/signal-buddy-app-icon-small.svg"
MARK_SVG="$ROOT/brand/logo/signal-buddy-mark.svg"
HORIZONTAL_SVG="$ROOT/brand/logo/hapi-companion-horizontal.svg"
MENU_SVG="$ROOT/brand/menu-bar/signal-buddy-menubar.svg"
EXPORTS="$ROOT/brand/exports"
ASSETS="$ROOT/Resources/Assets.xcassets"
APPSET="$ASSETS/AppIcon.appiconset"
MENUSET="$ASSETS/MenuBarIcon.imageset"
ICONSET="$ROOT/.build/brand/HAPI Companion.iconset"

mkdir -p "$EXPORTS" "$APPSET" "$MENUSET" "$ICONSET"
sips -s format png "$APP_SVG" --out "$EXPORTS/hapi-companion-app-icon-1024.png" >/dev/null
sips -s format png "$SMALL_APP_SVG" --out "$EXPORTS/hapi-companion-app-icon-small-64.png" >/dev/null
sips -s format png "$MARK_SVG" --out "$EXPORTS/signal-buddy-mark-1024.png" >/dev/null
sips -z 1024 1024 "$EXPORTS/signal-buddy-mark-1024.png" --out "$EXPORTS/signal-buddy-mark-1024.png" >/dev/null
sips -s format png "$HORIZONTAL_SVG" --out "$EXPORTS/hapi-companion-horizontal-1200.png" >/dev/null
sips -s format png "$MENU_SVG" --out "$EXPORTS/signal-buddy-menubar-36.png" >/dev/null
sips -z 18 18 "$EXPORTS/signal-buddy-menubar-36.png" --out "$EXPORTS/signal-buddy-menubar-18.png" >/dev/null

while read -r output size; do
  source="$EXPORTS/hapi-companion-app-icon-1024.png"
  (( size <= 64 )) && source="$EXPORTS/hapi-companion-app-icon-small-64.png"
  sips -z "$size" "$size" "$source" --out "$APPSET/$output" >/dev/null
  cp "$APPSET/$output" "$ICONSET/$output"
done <<'SIZES'
icon_16x16.png 16
icon_16x16@2x.png 32
icon_32x32.png 32
icon_32x32@2x.png 64
icon_128x128.png 128
icon_128x128@2x.png 256
icon_256x256.png 256
icon_256x256@2x.png 512
icon_512x512.png 512
icon_512x512@2x.png 1024
SIZES

cp "$EXPORTS/signal-buddy-menubar-18.png" "$MENUSET/signal-buddy-menubar-18.png"
cp "$EXPORTS/signal-buddy-menubar-36.png" "$MENUSET/signal-buddy-menubar-36.png"
iconutil -c icns "$ICONSET" -o "$EXPORTS/HAPI Companion.icns"

(
  cd "$ROOT"
  find brand -type f \
    ! -name CHECKSUMS.sha256 \
    -print0 | sort -z | xargs -0 shasum -a 256
) > "$ROOT/brand/CHECKSUMS.sha256"

echo "Generated app, logo, menu-bar, and ICNS assets."
