#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TARGET="${1:-bun-linux-x64}"
case "$TARGET" in
  bun-linux-x64) ARCH=x86_64 ;;
  bun-linux-arm64) ARCH=aarch64 ;;
  *) echo "unsupported target: $TARGET" >&2; exit 2 ;;
esac
cd "$ROOT/relay"
bun install --frozen-lockfile
bun run typecheck
bun test
bun run smoke
rm -rf dist/bundle
mkdir -p dist/bundle
bun build src/main.ts --compile --target="$TARGET" --outfile=dist/bundle/hapi-mobile-relay
HASH="$(shasum -a 256 dist/bundle/hapi-mobile-relay | awk '{print $1}')"
install -m 0644 packaging/hapi-mobile-relay.service dist/bundle/
install -m 0644 API.md README.md ../docs/deployments/V0_4_MOBILE_RELAY_RUNBOOK.md dist/bundle/
install -m 0755 ../scripts/install-mobile-relay.sh dist/bundle/
install -m 0755 packaging/smoke-bundle.sh dist/bundle/
cat >dist/bundle/manifest.json <<EOF
{"version":"0.4.1","architecture":"$ARCH","sha256":"$HASH","stateSchema":1,"managementApi":1}
EOF
tar -C dist/bundle -czf "dist/hapi-mobile-relay-0.4.1-$ARCH.tar.gz" .
SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hapi-relay-bundle.XXXXXX")"
trap 'rm -rf "$SMOKE_DIR"' EXIT
tar -C "$SMOKE_DIR" -xzf "dist/hapi-mobile-relay-0.4.1-$ARCH.tar.gz"
(cd /tmp && "$SMOKE_DIR/smoke-bundle.sh" "$SMOKE_DIR")
shasum -a 256 "dist/hapi-mobile-relay-0.4.1-$ARCH.tar.gz"
echo "binary sha256 $HASH"
