# V0.6 official-HAPI Sidecar runbook

This is a candidate runbook. It does not authorize a production change. Production currently remains on the accepted patched HAPI path.

## Preconditions

- clean official HAPI package passes the compatibility suite;
- Sidecar Linux package, Mac tests and Relay tests pass;
- current Relay state, patched HAPI package/database and Mac binding rollback material are retained;
- operator has separately approved the target VM, public Sidecar origin and migration window.

Never put the HAPI access token in an environment variable, command argument, log, issue or HTTP request to the Sidecar. Install it as a root-controlled `0600` source for systemd `LoadCredential`. The service sees only the runtime credential copy.

The non-secret environment file contains exactly the three HTTPS origins and the mode:

```text
HAPI_SIDECAR_HAPI_ORIGIN=https://hapi.example
HAPI_SIDECAR_PUBLIC_ORIGIN=https://hapi.example
HAPI_SIDECAR_API_ORIGIN=https://relay.example
HAPI_SIDECAR_DELIVERY_MODE=shadow
```

Use the packaged `hapi-companion-sidecar.service`. It has its own immutable tree under `/opt/hapi-companion-sidecar`, private state under `/var/lib/hapi-companion-sidecar`, and loopback port `8790`; it does not replace the live Mobile Relay binary, JSON state or port `8789` during shadow. Expose only the approved `/health`, `/v1`, `/v2` and `/companion` routes through the existing HTTPS reverse proxy when the migration phase calls for them. The proxy must replace client-supplied forwarding headers.

## Backup

Do not copy a live SQLite main file by itself. Use `hapi-mobile-relay sidecar-backup <new-absolute-path>`; it creates a consistent `VACUUM INTO` snapshot, enforces `0600` and runs `PRAGMA integrity_check`. The offline alternative is to stop the service, checkpoint with `PRAGMA wal_checkpoint(TRUNCATE)`, verify no writer remains, and copy the database. Fsync the accepted backup and record its SHA-256 without printing file contents. Copy secret files separately with `0600`; exclude them from diagnostics.

Also retain the existing Relay JSON state, prior binary and service unit. HAPI binary rollback across a database schema change requires the matching HAPI database snapshot managed by Safe Updater. The Sidecar works from a private copy of Relay control state; never let the legacy Relay and Sidecar write the same JSON path.

## Shadow acceptance

Start with `HAPI_SIDECAR_DELIVERY_MODE=shadow`. Shadow mode records semantic observations and source health but creates no Mac or ntfy delivery rows. Verify:

1. one official HAPI SSE connection and no polling;
2. authentication, catalog and connected/resume state without credential exposure;
3. real ready, input, permission, task and completion observations;
4. Hub restart produces a documented gap resync;
5. RSS, CPU, database/WAL size and reconnect behavior remain within the V0.6 budget.

Create a temporary root-owned mode-`0600` comparison key with at least 32 random bytes. Run `hapi-mobile-relay sidecar-shadow-report <absolute-key-file>` locally on the VM after each controlled canary sequence. The report contains only event kind, count, high-water sequence and an HMAC-SHA256 session fingerprint; it excludes session IDs, titles, bodies, topics and credentials. Trigger the five kinds in one known canary session, compare the reported kind counts and common session fingerprint with the expected sequence and the concurrently observed patched notifications, then securely discard the temporary key and report after recording the pass/fail result. Never send either file through chat or logs.

## Authorized cutover

Cut over only in a quiet window with no active turn. Drain the patched consumers and stop the old ntfy dispatcher. With both writers stopped, copy the latest legacy Relay JSON to the Sidecar's private state path with the same owner and mode, preserving the untouched legacy original for rollback. Change the environment ceiling to `HAPI_SIDECAR_DELIVERY_MODE=active`, restart the Sidecar, switch the approved proxy routes from loopback `8789` to `8790`, and wait until authenticated `GET /v2/status` reports `source.state=live` while `delivery.enabled=false`. Generate a new one-time pair code only when the Mac has no retained management binding.

In Mac settings, pair the Relay or choose “Mac 使用 Sidecar”. The app creates a temporary consumer, probes authenticated status, catalog and the first SSE connected frame, and only then stores the v2 Keychain binding. A failed probe revokes the temporary consumer and leaves the legacy binding active. Configure the mobile rules, then explicitly activate the v2 ntfy receiver. This writes the durable cutover timestamp and opens delivery only if the source is live; an environment change or restart alone cannot activate notifications.

Perform one real HAPI turn and confirm:

- Mac banner and permitted sound;
- click reuses the HAPI PWA and opens the exact session;
- OPPO notification arrives and opens that session;
- Mac offline does not block phone delivery and an ntfy failure does not block Mac replay;
- management/status responses and logs contain no token, topic or credential fields.

After acceptance, record the immutable package hash, Sidecar database schema 2, `/v2/status` source/cutover fields, Mac build, and rollback target. Do not retire the HAPI patch in the same window.

## Candidate package

Build with `./scripts/package-sidecar.sh bun-linux-x64`. The bundle contains the compiled executable, hardened unit, installer, API/runbook and a manifest binding the binary SHA-256, architecture, Sidecar schema 2, management API 2 and consumer contract 1. The operator selects the package matching the VM architecture; the installer verifies strict semver and the expected artifact hash and never enables or restarts the service. It refuses to touch an active Sidecar. For an upgrade, first create and verify the schema-matched SQLite/JSON rollback set, stop the service, install the candidate, and start it explicitly. If acceptance fails, stop it and restore the prior binary, database, JSON state and unchanged secret set together before starting the prior service. There is deliberately no binary-only automatic rollback.

Run `./scripts/test-official-hapi-v0307.sh` before packaging. It refuses a dirty or wrong-baseline checkout, runs that exact upstream version's session/message/replay/namespace tests, and starts clean official commit `0239edf38e2da653d662f31039e24ccea04c7837` in an isolated directory for a real authentication, namespace-identity, catalog and SSE connected/resume handshake. The five semantic notification shapes remain covered locally by adapter/interpreter fixtures because generating all five requires real Runner activity; production shadow must exercise all five before cutover.

## Rollback

Stop Sidecar delivery first so there is never a second ntfy dispatcher. When safe, drain already-observed Sidecar events. Restore the prior Relay state/unit and patched HAPI path, then remove the Mac v2 binding or select the retained legacy binding. Validate the old stream and a real notification before closing the window. Restore the pre-migration SQLite/JSON and secret set as a unit; in-place schema downgrade is forbidden.
