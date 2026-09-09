#!/bin/zsh
set -u

failures=0
ok() { printf '✓ %s\n' "$1"; }
warn() { printf '! %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; failures=$((failures + 1)); }

[[ "$(uname -s)" == "Darwin" ]] && ok "macOS detected" || fail "HAPI Companion requires macOS"
major="$(sw_vers -productVersion 2>/dev/null | cut -d. -f1)"
if [[ "$major" == <-> ]] && (( major >= 14 )); then ok "macOS $major is supported"; else fail "macOS 14 or newer is required"; fi

command -v xcodebuild >/dev/null && ok "xcodebuild is available" || fail "Install Xcode or Xcode command-line tools"
command -v xcodegen >/dev/null && ok "xcodegen is available" || fail "Install XcodeGen (for example: brew install xcodegen)"

source "${0:A:h}/hapi-home.sh"
if (( $# == 0 )); then
  companion_home="$(resolve_companion_home)" || exit 1
elif (( $# == 2 )) && [[ "$1" == "--hapi-home" ]]; then
  companion_home="$(resolve_companion_home "$2")" || exit 1
else
  print -u2 'Usage: ./scripts/doctor.sh [--hapi-home /absolute/config/directory]'
  exit 1
fi
settings="$companion_home/settings.json"
ok "Selected HAPI configuration directory: $companion_home"
if [[ -r "$settings" ]]; then ok "HAPI CLI settings found"; else fail "Missing $settings; install and log in with HAPI CLI first"; fi

if [[ -r "$settings" ]]; then
  hub_url="$(plutil -extract apiUrl raw -o - "$settings" 2>/dev/null || true)"
  token_present="$(plutil -extract cliApiToken raw -o - "$settings" 2>/dev/null || true)"
  [[ "$hub_url" == http://* || "$hub_url" == https://* ]] && ok "HAPI Hub URL is configured" || fail "apiUrl is missing or invalid"
  [[ -n "$token_present" ]] && ok "HAPI CLI credential is present (value hidden)" || fail "cliApiToken is missing"
  if [[ -n "$hub_url" ]]; then
    http_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 8 "$hub_url/companion/events" || true)"
    if [[ "$http_status" == "401" ]]; then ok "Hub exposes the Companion event endpoint"
    elif [[ "$http_status" == "404" ]]; then fail "Hub does not expose /companion/events; install the Hub integration first"
    else warn "Could not conclusively verify Hub integration (HTTP ${http_status:-none})"; fi
  fi
fi

edge_apps="$HOME/Applications/Edge Apps.localized"
if [[ -d "$edge_apps" ]] && find "$edge_apps" -maxdepth 1 -name '*.app' -print -quit | grep -q .; then
  ok "At least one Edge PWA is installed"
else
  warn "No Edge PWA found; exact links will use the browser fallback"
fi

if (( failures > 0 )); then printf '\nDoctor found %d blocking problem(s).\n' "$failures" >&2; exit 1; fi
printf '\nReady to build and install HAPI Companion.\n'
