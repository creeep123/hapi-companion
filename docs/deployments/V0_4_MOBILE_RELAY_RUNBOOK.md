# V0.4 Mobile Relay deployment runbook

Status: implementation candidate. This runbook installs only the Companion-owned Relay. It does not update HAPI, its integration patch, or `hapi-safe-updater`.

## Supported baseline and artifacts

- Linux with systemd, Bun-compiled executable, and an existing TLS reverse proxy.
- Build either `bun-linux-x64` or `bun-linux-arm64` to match the VM. Record the Companion commit, version, architecture and printed SHA-256 before copying the artifact.
- The service binds only to `127.0.0.1:8789`. Give it a dedicated HTTPS hostname or a proxy mapping that preserves its root paths.

Run `scripts/package-mobile-relay.sh bun-linux-x64` (or `bun-linux-arm64`) on a clean pushed Companion commit. It runs the fake-provider smoke and produces a complete archive containing the binary, unit, API/runbook and manifest. Verify the printed archive and binary SHA-256 values after transfer; the manifest architecture must match the VM.

## State and backup boundary

Runtime state is `/var/lib/hapi-mobile-relay/state.json`, owned by the dedicated `hapi-mobile-relay` user with mode `0600`; its directory is `0700`. It contains the Hub device credential and ntfy topic. Do not print, copy into tickets, include in support bundles, or put it in an ordinary plaintext backup. If retention is required, use the operator's encrypted backup system and test restore permissions without viewing contents.

Before upgrade, record a hash and take an encrypted backup. Rollback must restore the binary and, only when the state schema is incompatible, its matching encrypted state. Schema v1 is retained across V0.4 upgrades. The handled ledger retains at least 35 days, exceeding the current Hub outbox retention requirement.

## Install and reverse proxy

After verifying the artifact, run as root:

```bash
./scripts/install-mobile-relay.sh /path/to/hapi-mobile-relay 0.4.1 <binary-sha256>
systemctl enable --now hapi-mobile-relay
systemctl status hapi-mobile-relay
curl -fsS http://127.0.0.1:8789/health
```

The installer rejects non-semver versions, path escapes, checksum mismatches and wrong-architecture binaries. It stages a versioned immutable binary and atomically switches `current`. An active installation is restarted and health-checked; failure switches back to and restarts the previous target. A first install remains stopped for inspection. Configure a dedicated HTTPS reverse-proxy origin to `http://127.0.0.1:8789`. Limit request bodies to 64 KiB, preserve response streaming, and overwrite rather than append `X-Forwarded-For`; pairing failure limits rely on the trusted proxy source value. Never proxy the loopback listener over plaintext Internet access. Validate the public `/health` response is JSON `{ "ok": true, "version": 1 }`; an HTML 200 is failure.

Changing the production reverse proxy or starting this new production service requires the operator approval named in the V0.4 spec.

## One-time pairing

Stop the service before generating a code so the command and daemon never write the state file concurrently:

```bash
systemctl stop hapi-mobile-relay
sudo -u hapi-mobile-relay HAPI_MOBILE_RELAY_STATE=/var/lib/hapi-mobile-relay/state.json \
  /opt/hapi-mobile-relay/current/hapi-mobile-relay pair-code
systemctl start hapi-mobile-relay
```

The printed code has at least 128 bits of entropy, expires after ten minutes and is consumed once. Transfer it directly to the Mac pairing UI through the authorized installation channel; never place it in chat or logs. Successful pairing returns a management bearer to the Mac once; the Relay persists only its hash and the Mac stores the bearer in Keychain.

`DELETE /v1/receiver` removes the phone destination and Hub device credential while preserving this Relay pairing so another phone can be added. `POST /v1/unpair` additionally revokes the management bearer. Generate a fresh one-time code before pairing again.

## Management and activation behavior

Only `/health` and `/v1/pair` are unauthenticated. Status, configuration, test, activation, repair, pause, receiver removal and unpair require the Relay management bearer. Responses use `Cache-Control: no-store` and never return stored topics or Hub credentials.

The Mac sends a real catalog `sessionId` to `/v1/test`; the Relay rebuilds the exact click target from the configured HAPI HTTPS origin and always uses fixed safe test text. Test does not create or ACK a Hub event. After the user confirms receipt/opening, the Mac registers a stable Relay installation with the existing Hub API and commits it with a stable `activationId`. Same-ID activation requires an identical persisted request fingerprint; a competing payload fails with 409. An unknown result remains pending and is queried/retried—temporary absence is not proof of rejection and must not trigger Hub deletion. Explicit rejection is compensated through the existing Hub DELETE route. Invalid committed Hub credentials are replaced only through the explicit authenticated repair operation. Configuration updates restart the stream reliably; repaired attention states use authenticated `/v1/resume`.

Relay 0.4.1 adds top-level config `contentMode`. Missing legacy values become `fixed`; supported values are `fixed` and `eventPreview`. Authenticated status advertises `capabilities.notificationContentModes`; a controller must check this before enabling or reporting preview synchronization. `eventPreview` is privacy-sensitive and may be enabled with public ntfy only after a separate explicit user opt-in. It sends the validated event title (maximum 256 UTF-8 bytes) and body (maximum 4096 UTF-8 bytes) after Unicode/control-character cleanup. It does not persist those fields in state, ledger, health or logs. The event URL and all other event fields remain excluded, and the click target is always rebuilt. Changing content mode is a revisioned configuration update and follows the same stream restart, ledger-before-ACK and at-least-once boundary as destination rotation.

Pausing keeps the single SSE active and durably handles/ACKs arrivals without ntfy posts. Removing stops the stream and clears receiver state; the controlling Mac then disables the Hub device. A repeated Hub DELETE 404 means already removed.

## Acceptance and observability

Public `/health` proves only that the process answers. Authenticated `/v1/status` separately reports configuration revision, supported notification-content modes, enabled/paused state, Hub stream status, last ACK, last ntfy acceptance and attention state. Provider acceptance never proves handset display.

Use the Mac settings card for normal readiness checks. For an operator diagnostic on the paired Mac, keep the bearer out of command history and process arguments by using a private temporary curl config:

```bash
read -rsp 'Relay management bearer: ' RELAY_TOKEN; echo
RELAY_CURL_CONFIG="$(mktemp)"; chmod 600 "$RELAY_CURL_CONFIG"
trap 'rm -f "$RELAY_CURL_CONFIG"; unset RELAY_TOKEN' EXIT
printf 'header = "Authorization: Bearer %s"\n' "$RELAY_TOKEN" >"$RELAY_CURL_CONFIG"
unset RELAY_TOKEN
curl --fail --silent --show-error --config "$RELAY_CURL_CONFIG" https://relay.example/v1/status
```

Do not paste the bearer into the command line, run this with shell tracing, retain the temporary file, or attach its contents/output to support records. The response contains only non-secret readiness fields.

Before service switch, run typecheck/tests and a fake-provider smoke test. After approval and switch, verify:

1. one SSE and no Hub polling;
2. test notification reaches the subscribed OPPO and opens the exact catalog session;
3. a real qualifying completion arrives with VPN off and screen locked while the Mac is closed/asleep;
4. short/nonmatching and full-quiet events produce zero provider posts while advancing the Relay ledger and Hub ACK;
5. priority 2's actual sound behavior is recorded rather than inferred;
6. an unACKed event survives restart, upgrade and rollback without silent loss.

Record only redacted event-ID hashes, counters, timestamps, revisions, artifact hashes and service versions. Do not record topics, credentials, session identifiers or private hostnames.

## Upgrade, rollback and uninstall

For N→N+1, build and verify the complete bundle, take the approved encrypted state backup, unpack it in a private temporary directory and run `smoke-bundle.sh`. Then invoke its installer with binary path, strict version and manifest SHA. If the unit is active, the installer stages the candidate, atomically switches `current`, restarts it and checks loopback health. If restart or health fails, it atomically restores the previous target, restarts that version and checks rollback health before returning failure. Retain the previous version directory as the rollback target. After installer success, verify authenticated readiness and replay separately; loopback health alone is insufficient.

For an intentional N+1→N rollback, invoke the same installer with the verified prior binary, its prior semantic version and SHA. It performs the same atomic switch, restart and automatic failure rollback. Restore matching encrypted state before the switch only when the recorded schema compatibility requires it. A rollback is complete only after authenticated readiness and the deliberately unACKed event's replay/ACK pass.

Uninstall stops/disables the unit and removes the binary/unit. Preserve `/var/lib/hapi-mobile-relay` by default; deleting it irreversibly destroys credentials, configuration and ledger and therefore requires a separate operator decision.
