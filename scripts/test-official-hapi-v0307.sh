#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
OFFICIAL="${HAPI_OFFICIAL_CHECKOUT:-$ROOT/.worktrees/hapi-v0307-official}"
BASELINE=0239edf38e2da653d662f31039e24ccea04c7837
[[ -d "$OFFICIAL/.git" || -f "$OFFICIAL/.git" ]] || { echo "clean official HAPI checkout missing" >&2; exit 1; }
[[ "$(git -C "$OFFICIAL" rev-parse HEAD)" == "$BASELINE" ]] || { echo "official HAPI baseline mismatch" >&2; exit 1; }
[[ -z "$(git -C "$OFFICIAL" status --porcelain --untracked-files=no)" ]] || { echo "official HAPI checkout has tracked changes" >&2; exit 1; }

GATE_ROOT="$(mktemp -d "$ROOT/.build-v06/official-hapi-gate.XXXXXX")"
chmod 700 "$GATE_ROOT"
PORT="$(python3 - <<'PY'
import socket
s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()
PY
)"
TEST_TOKEN="integration-test-$RANDOM-$RANDOM-0000000000000000"
(
  cd "$OFFICIAL"
  CLI_API_TOKEN="$TEST_TOKEN" HAPI_HOME="$GATE_ROOT" HAPI_LISTEN_HOST=127.0.0.1 HAPI_LISTEN_PORT="$PORT" \
    HAPI_PUBLIC_URL="http://127.0.0.1:$PORT" HAPI_ANDROID_PUSH=off HAPI_IOS_PUSH=off \
    bun run hub/src/index.ts --no-relay >"$GATE_ROOT/hub.log" 2>&1
) &
HUB_PID=$!
cleanup() { kill "$HUB_PID" 2>/dev/null || true; wait "$HUB_PID" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 150); do
  if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null
(cd "$ROOT/relay" && bun run smoke/official-hapi-gate.ts "http://127.0.0.1:$PORT" "$TEST_TOKEN")
