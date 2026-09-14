#!/usr/bin/env bash
set -euo pipefail

BUNDLE="$(realpath "${1:-$(dirname "$0")}")"
for file in hapi-mobile-relay hapi-mobile-relay.service install-mobile-relay.sh manifest.json API.md V0_4_MOBILE_RELAY_RUNBOOK.md; do
  [[ -f "$BUNDLE/$file" ]] || { echo "bundle missing $file" >&2; exit 1; }
done
EXPECTED="$(sed -n 's/.*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$BUNDLE/manifest.json")"
if command -v sha256sum >/dev/null 2>&1; then ACTUAL="$(sha256sum "$BUNDLE/hapi-mobile-relay" | awk '{print $1}')"; else ACTUAL="$(shasum -a 256 "$BUNDLE/hapi-mobile-relay" | awk '{print $1}')"; fi
[[ -n "$EXPECTED" && "$EXPECTED" == "$ACTUAL" ]] || { echo "bundle binary hash mismatch" >&2; exit 1; }
bash -n "$BUNDLE/install-mobile-relay.sh"

if [[ "$(uname -s)" == Linux ]]; then
  case "$(uname -m)" in x86_64) EXPECT_ARCH=x86_64;; aarch64|arm64) EXPECT_ARCH=aarch64;; *) EXPECT_ARCH=unsupported;; esac
  MANIFEST_ARCH="$(sed -n 's/.*"architecture":"\([^"]*\)".*/\1/p' "$BUNDLE/manifest.json")"
  if [[ "$EXPECT_ARCH" == "$MANIFEST_ARCH" ]]; then
    STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hapi-relay-state.XXXXXX")"; chmod 700 "$STATE_DIR"
    PORT=$((20000 + RANDOM % 20000))
    HAPI_MOBILE_RELAY_STATE="$STATE_DIR/state.json" HAPI_MOBILE_RELAY_PORT="$PORT" "$BUNDLE/hapi-mobile-relay" serve >"$STATE_DIR/output" 2>&1 & PID=$!
    trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; rm -rf "$STATE_DIR"' EXIT
    for _ in $(seq 1 50); do curl -fsS --max-time 1 "http://127.0.0.1:$PORT/health" | grep -q '"ok":true' && break; sleep 0.1; done
    curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" | grep -q '"ok":true'
    kill -TERM "$PID"; wait "$PID"; rm -rf "$STATE_DIR"; trap - EXIT
  fi
fi
echo "release bundle smoke passed"
