#!/usr/bin/env bash
set -euo pipefail
BUNDLE="$(realpath "${1:-$(dirname "$0")}")"
for file in hapi-mobile-relay hapi-companion-sidecar.service install-sidecar.sh manifest.json API.md README.md V0_6_OFFICIAL_HAPI_SIDECAR_RUNBOOK.md; do [[ -f "$BUNDLE/$file" ]] || { echo "bundle missing $file" >&2; exit 1; }; done
EXPECTED="$(sed -n 's/.*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$BUNDLE/manifest.json")"
if command -v sha256sum >/dev/null 2>&1; then ACTUAL="$(sha256sum "$BUNDLE/hapi-mobile-relay" | awk '{print $1}')"; else ACTUAL="$(shasum -a 256 "$BUNDLE/hapi-mobile-relay" | awk '{print $1}')"; fi
[[ -n "$EXPECTED" && "$EXPECTED" == "$ACTUAL" ]] || { echo "bundle binary hash mismatch" >&2; exit 1; }
bash -n "$BUNDLE/install-sidecar.sh"
grep -q 'serve-sidecar' "$BUNDLE/hapi-companion-sidecar.service"
grep -q 'LoadCredential=hapi-access-token:' "$BUNDLE/hapi-companion-sidecar.service"
echo "sidecar release bundle smoke passed"
