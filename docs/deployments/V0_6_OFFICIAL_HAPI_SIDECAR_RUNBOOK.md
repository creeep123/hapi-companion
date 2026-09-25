# V0.6 official-HAPI Sidecar runbook

This is a candidate runbook. It does not authorize a production change. Production currently remains on the accepted patched HAPI path.

The exact alpha.9 private-shadow artifact, resource limits, 30-minute window and stop conditions are recorded in [the shadow proposal](V0_6_ALPHA9_SHADOW_PROPOSAL.md). A separate approval is required before starting it on the VM.

Before an authorized first start, fill in the [alpha.9 pre-start checklist](V0_6_ALPHA9_SHADOW_PRESTART_CHECKLIST.md).

## Preconditions

- clean official HAPI package passes the compatibility suite;
- Sidecar Linux package, Mac tests and Relay tests pass;
- current Relay state, patched HAPI package/database and Mac binding rollback material are retained;
- operator has separately approved the target VM and bounded shadow window; public Sidecar routing and notification migration require later, separate approval.

Never put the HAPI access token in an environment variable, command argument, log, issue or HTTP request to the Sidecar. Install it as a root-controlled `0600` source for systemd `LoadCredential`. The service accepts the runtime copy only at the exact `CREDENTIALS_DIRECTORY/hapi-access-token` path and only with systemd's root-owned, read-only credential-mount permissions; an explicit non-systemd file must remain owned by the service UID with no group or world access.

The non-secret environment file contains exactly the three HTTPS origins and the mode:

```text
HAPI_SIDECAR_HAPI_ORIGIN=https://hapi.example
HAPI_SIDECAR_PUBLIC_ORIGIN=https://hapi.example
HAPI_SIDECAR_API_ORIGIN=https://relay.example
HAPI_SIDECAR_DELIVERY_MODE=shadow
```

Use the packaged `hapi-companion-sidecar.service`. It has its own immutable tree under `/opt/hapi-companion-sidecar`, private state under `/var/lib/hapi-companion-sidecar`, and loopback port `8791`; it does not replace the live Mobile Relay binary, JSON state or port `8789` during shadow. Port `8790` is already reserved by the production Nginx ingress and must not be reused. Expose only the approved `/health`, `/v1`, `/v2` and `/companion` routes through the existing HTTPS reverse proxy when the migration phase calls for them. The proxy must replace client-supplied forwarding headers.

## Backup

Before calling `scripts/install-sidecar.sh`, check for any prior `/opt/hapi-companion-sidecar` tree, `current` link, unit or private state, even if the service is inactive. The installer verifies the new binary but can replace an inactive unit and version-path binary and repoint `current`; it does not preserve the old installation. If the old service is active, stop it only within the separately approved scope; otherwise cancel the install. Confirm no JSON/SQLite writer remains before capturing the matched control-state set. Capture the exact old `current` link and resolved target, complete old package tree/binary and hashes, base unit plus drop-ins/effective unit, environment file and previous active/enabled state. Capture the matching private control JSON, consistent SQLite snapshot and source-secret files as one rollback set. Verify owners, modes, schema, integrity and checksums before installation. A missing or unverified member blocks the install; do not infer that an inactive service has no state. If the incoming version path already exists, its old contents also need a separate verified copy because the installer writes that path.

Do not copy a live SQLite main file by itself. Use `hapi-mobile-relay sidecar-backup <new-absolute-path>`; it creates a consistent `VACUUM INTO` snapshot, enforces `0600` and runs `PRAGMA integrity_check`. The offline alternative is to stop the service, checkpoint with `PRAGMA wal_checkpoint(TRUNCATE)`, verify no writer remains, and copy the database. Fsync the accepted backup and record its SHA-256 without printing file contents. Copy secret files separately with `0600`; exclude them from diagnostics.

Also retain the existing Relay JSON state, prior binary and service unit. HAPI binary rollback across a database schema change requires the matching HAPI database snapshot managed by Safe Updater. The Sidecar works from a private copy of Relay control state; never let the legacy Relay and Sidecar write the same JSON path.

## Bounded first shadow: partial Phase B

After separate approval and the pre-install backup gate, start with `HAPI_SIDECAR_DELIVERY_MODE=shadow`. Shadow mode records semantic observations and source health but creates no Mac or ntfy delivery rows. This 30-minute alpha.9 trial is **partial Phase B**, not complete shadow or cutover acceptance. Verify:

1. one official HAPI SSE connection and no polling;
2. authentication, catalog and connected/resume state without credential exposure;
3. one real ready observation compared with the authoritative patched path; fixtures cover the other four semantic kinds locally but do not establish real VM parity;
4. an isolated forced-gap test proves current-state recovery without message-history scanning; do not restart the production Hub for this gate;
5. at least four 75-second idle/reconnect cycles keep the source live, followed by RSS, CPU, database/WAL and reconnect checks within the V0.6 budget.

Create a temporary comparison key with at least 32 random bytes inside `/var/lib/hapi-companion-sidecar`, owned by `hapi-mobile-relay` and mode `0600`. Run the report as that same service user, with the unit's private paths explicitly supplied:

```text
sudo -u hapi-mobile-relay env \
  HAPI_MOBILE_RELAY_STATE=/var/lib/hapi-companion-sidecar/state.json \
  HAPI_SIDECAR_DB=/var/lib/hapi-companion-sidecar/sidecar.sqlite \
  /opt/hapi-companion-sidecar/current/hapi-mobile-relay \
  sidecar-shadow-report /var/lib/hapi-companion-sidecar/shadow-report.key
```

The report contains only event kind, count, high-water sequence and an HMAC-SHA256 session fingerprint; it excludes session IDs, titles, bodies, topics and credentials. For this one bounded retry, compare one real ready observation with the authoritative patched notification, then delete the temporary key and report after recording the pass/fail result. Never send either file through chat or logs. The private shadow must keep delivery rows at zero, leave the legacy Relay healthy and add no public route or client binding. Any recurrence of source attention stops V0.6 rather than creating another candidate.

The specification's full Phase B also calls for real completion, task, permission and input-request comparisons. Until those are observed in a controlled canary and pass, or the product owner explicitly revises that requirement, record Phase B as incomplete and do not cut over Mac or phone notifications.

The follow-on [five-kind canary plan](V0_6_PHASE_B_FIVE_KIND_CANARY.md) defines the separate authorization, safe event triggers, private one-to-one comparison, stop/restore conditions and remaining Phase C gate. The aggregate shadow report alone cannot prove one-to-one parity or event timing.

## Authorized cutover

Cut over only in a quiet window with no active turn. Drain the patched consumers and stop the old ntfy dispatcher. With both writers stopped, copy the latest legacy Relay JSON to the Sidecar's private state path with the same owner and mode, preserving the untouched legacy original for rollback. Change the environment ceiling to `HAPI_SIDECAR_DELIVERY_MODE=active`, restart the Sidecar, switch the approved proxy routes from loopback `8789` to `8791`, and wait until authenticated `GET /v2/status` reports `source.state=live` while `delivery.enabled=false`. Generate a new one-time pair code only when the Mac has no retained management binding.

In Mac settings, pair the Relay or choose “Mac 使用 Sidecar”. The app creates a temporary consumer, probes authenticated status, catalog and the first SSE connected frame, and only then stores the v2 Keychain binding. A failed probe revokes the temporary consumer and leaves the legacy binding active. Configure the mobile rules, then explicitly activate the v2 ntfy receiver. This writes the durable cutover timestamp and opens delivery only if the source is live; an environment change or restart alone cannot activate notifications.

Perform one real HAPI turn and confirm:

- Mac banner and permitted sound;
- click reuses the HAPI PWA and opens the exact session;
- OPPO notification arrives and opens that session;
- Mac offline does not block phone delivery and an ntfy failure does not block Mac replay;
- management/status responses and logs contain no token, topic or credential fields.

After acceptance, record the immutable package hash, Sidecar database schema 2, `/v2/status` source/cutover fields, Mac build, and rollback target. Do not retire the HAPI patch in the same window.

## Candidate package

Build with `./scripts/package-sidecar.sh bun-linux-x64`. The bundle contains the compiled executable, hardened unit, installer, API/runbook and a manifest binding the binary SHA-256, architecture, Sidecar schema 2, management API 2 and consumer contract 1. The operator selects the package matching the VM architecture; the installer verifies strict semver and the expected artifact hash and never enables or restarts the service. It refuses to touch an active Sidecar, but **can overwrite an inactive installation**, so complete the matched-set backup above first. For an upgrade, stop the service, install the candidate, and start it explicitly. If acceptance fails, stop it and restore the old package/current link, unit/drop-ins, environment, matching database, JSON state and unchanged secret set together. There is deliberately no binary-only automatic rollback.

Run `./scripts/test-official-hapi-v0307.sh` before packaging. It refuses a dirty or wrong-baseline checkout, runs that exact upstream version's session/message/replay/namespace tests, and starts clean official commit `0239edf38e2da653d662f31039e24ccea04c7837` in an isolated directory for a real authentication, namespace-identity, catalog and SSE connected/resume handshake. All five semantic notification shapes remain covered locally by adapter/interpreter fixtures. The **first partial Phase-B trial** requires one real ready observation; it does not wait for rare kinds to occur naturally and does not complete the full real-event comparison.

## Rollback

For a failed **shadow-only** trial, stop the Sidecar and ensure port `8791` closes. Remove only this trial's resource-limit drop-in; restore its old package tree, exact `current` target, base unit/drop-ins, environment, matching JSON/SQLite snapshot and secret set; reload systemd. Verify restored file hashes/modes, SQLite `integrity_check`, schema version, non-sensitive row counts, consumer cursors and an old-package disabled-delivery startup against an isolated copy of the restored state. Return to the previous active/enabled state only after these checks; if it was inactive, leave it inactive. Keep Hub, Runner, legacy Relay and their data untouched. If any restore check fails, keep the Sidecar stopped, leave the legacy Relay authoritative and report recovery as unresolved.

For a later authorized **notification cutover**, stop Sidecar delivery first so there is never a second ntfy dispatcher. When safe, drain already-observed Sidecar events. Restore the prior Relay state/unit and patched HAPI path, then remove the Mac v2 binding or select the retained legacy binding. Validate the old stream and a real notification before closing the window. Restore the pre-migration SQLite/JSON and secret set as a unit; in-place schema downgrade is forbidden.
