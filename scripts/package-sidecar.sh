#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"; TARGET="${1:-bun-linux-x64}"; VERSION="${SIDECAR_VERSION:-0.6.0-alpha.9}"
case "$TARGET" in bun-linux-x64) ARCH=x86_64;; bun-linux-arm64) ARCH=aarch64;; *) echo "unsupported target: $TARGET" >&2; exit 2;; esac
cd "$ROOT/relay"; bun install --frozen-lockfile; bun run typecheck; bun test
mkdir -p dist/sidecar-bundle
bun build src/main.ts --compile --target="$TARGET" --outfile=dist/sidecar-bundle/hapi-mobile-relay
HASH="$(shasum -a 256 dist/sidecar-bundle/hapi-mobile-relay | awk '{print $1}')"
install -m 0644 packaging/hapi-companion-sidecar.service dist/sidecar-bundle/
install -m 0644 API.md README.md ../docs/deployments/V0_6_OFFICIAL_HAPI_SIDECAR_RUNBOOK.md dist/sidecar-bundle/
install -m 0755 ../scripts/install-sidecar.sh dist/sidecar-bundle/
install -m 0755 packaging/smoke-sidecar-bundle.sh dist/sidecar-bundle/
cat >dist/sidecar-bundle/manifest.json <<EOF
{"version":"$VERSION","architecture":"$ARCH","sha256":"$HASH","sidecarStateSchema":2,"managementApi":2,"consumerContract":1}
EOF
tar -C dist/sidecar-bundle -czf "dist/hapi-companion-sidecar-$VERSION-$ARCH.tar.gz" .
SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hapi-sidecar-bundle.XXXXXX")"; trap 'find "$SMOKE_DIR" -depth -delete 2>/dev/null || true' EXIT
tar -C "$SMOKE_DIR" -xzf "dist/hapi-companion-sidecar-$VERSION-$ARCH.tar.gz"; "$SMOKE_DIR/smoke-sidecar-bundle.sh" "$SMOKE_DIR"
shasum -a 256 "dist/hapi-companion-sidecar-$VERSION-$ARCH.tar.gz"; echo "binary sha256 $HASH"
