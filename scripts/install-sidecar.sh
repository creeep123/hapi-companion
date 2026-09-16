#!/usr/bin/env bash
set -euo pipefail

usage() { echo "usage: $0 <verified-sidecar-binary> <semver> <expected-sha256>" >&2; exit 2; }
[[ $# -eq 3 ]] || usage
ARTIFACT="$(realpath "$1")" || usage
VERSION="$2"; EXPECTED_SHA="$3"
CORE='(0|[1-9][0-9]*)'; PRE='(0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)'
SEMVER="^${CORE}\.${CORE}\.${CORE}(-${PRE}(\.${PRE})*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$"
[[ "$VERSION" =~ $SEMVER && "$VERSION" != */* ]] || { echo "version must be strict semver" >&2; exit 2; }
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ && -f "$ARTIFACT" && ! -L "$ARTIFACT" ]] || { echo "invalid artifact or SHA-256" >&2; exit 2; }
if command -v sha256sum >/dev/null 2>&1; then ACTUAL_SHA="$(sha256sum "$ARTIFACT" | awk '{print $1}')"; else ACTUAL_SHA="$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')"; fi
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || { echo "artifact SHA-256 mismatch" >&2; exit 1; }
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "run as root" >&2; exit 1; }

BASE=/opt/hapi-mobile-relay; INSTALL_DIR="$(realpath -m "$BASE/$VERSION")"
[[ "$INSTALL_DIR" == "$BASE/"* && "$INSTALL_DIR" != "$BASE/current" ]] || { echo "install path escaped base" >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"; UNIT_SOURCE="$(realpath "$SCRIPT_DIR/hapi-companion-sidecar.service")"
[[ "$UNIT_SOURCE" == "$SCRIPT_DIR/"* ]] || { echo "unit path escaped bundle" >&2; exit 2; }
id hapi-mobile-relay >/dev/null 2>&1 || useradd --system --home /var/lib/hapi-mobile-relay --shell /usr/sbin/nologin hapi-mobile-relay
install -d -o hapi-mobile-relay -g hapi-mobile-relay -m 0700 /var/lib/hapi-mobile-relay
install -d -o root -g root -m 0755 "$INSTALL_DIR"
install -o root -g root -m 0755 "$ARTIFACT" "$INSTALL_DIR/hapi-mobile-relay"
install -o root -g root -m 0644 "$UNIT_SOURCE" /etc/systemd/system/hapi-companion-sidecar.service
PREVIOUS="$(readlink "$BASE/current" 2>/dev/null || true)"
ln -sfn "$INSTALL_DIR" "$BASE/.current-$VERSION"; mv -Tf "$BASE/.current-$VERSION" "$BASE/current"
systemctl daemon-reload
if systemctl is-active --quiet hapi-companion-sidecar; then
  if ! systemctl restart hapi-companion-sidecar || ! curl -fsS --max-time 10 http://127.0.0.1:8789/health | grep -q '"ok":true'; then
    echo "candidate failed health; rolling back" >&2
    if [[ -n "$PREVIOUS" ]]; then ln -sfn "$PREVIOUS" "$BASE/current"; systemctl restart hapi-companion-sidecar; curl -fsS --max-time 10 http://127.0.0.1:8789/health | grep -q '"ok":true' || { echo "CRITICAL: rollback health failed" >&2; exit 1; }; else systemctl stop hapi-companion-sidecar; fi
    exit 1
  fi
  echo "upgraded and restarted hapi-companion-sidecar $VERSION" >&2
else
  echo "installed only; create the credential/environment files, inspect them, then enable shadow mode explicitly" >&2
fi
