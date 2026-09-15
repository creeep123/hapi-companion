# HAPI Hub integration

The native app depends on a device-scoped, durable notification transport that upstream HAPI does not currently expose. `hapi-companion.patch` contains the implementation used and tested by this project.

## Baseline

- Upstream: `https://github.com/tiann/hapi.git`
- Baseline commit: `0239edf38e2da653d662f31039e24ccea04c7837`
- Baseline description: HAPI `v0.30.7`
- Patch schema level: database schema v27
- Ported for HAPI v0.30.7: 2026-09-15
- Cumulative patch SHA-256: `2e75aa3ce6eaf7d965639d48feff3f0dc7ff4352306b48a1c28de1a5d35f5757`

Because HAPI evolves, treat this patch as a reviewed reference rather than a timeless installer.

## Apply in a clean worktree

```bash
git clone https://github.com/tiann/hapi.git
cd hapi
git checkout 0239edf38e2da653d662f31039e24ccea04c7837
git apply --check /path/to/hapi-companion/integrations/hapi/hapi-companion.patch
git apply /path/to/hapi-companion/integrations/hapi/hapi-companion.patch
bun install
bun run test
bun run typecheck
bun run build
```

Before deployment, back up the Hub database and record the current executable/container as the rollback target. Deploy the fully built Hub and embedded web assets together. The migration is forward-only, so rolling back the binary may also require restoring the database backup.

## API contract

- `POST /api/companion/devices/register`: normal HAPI user JWT; exchanges a stable local installation ID for a device-scoped token.
- `GET /companion/events`: device token plus `X-Hapi-Device-Id`; streams durable SSE events after the device ACK cursor.
- `GET /companion/sessions`: same device credentials; one-shot settings catalog, described below.
- `POST /companion/ack`: same device credentials; accepts `{ "seq": 123, "eventId": "..." }`.

The Hub validates namespace, device, sequence, and event ID before advancing the durable cursor.

## Design invariants

- Subscribe-before-replay closes the replay/live race.
- Replay is paginated and supports backlogs larger than 500 events.
- New devices begin at the namespace high-water mark.
- Task/session completion is deduplicated.
- Durable resume trusts only the server-side ACK cursor, not `Last-Event-ID`.
- Heartbeats and abort listeners are cancelled during cleanup.
- Old outbox data and inactive devices are pruned.

## Compatibility verification

An unauthenticated request should return `401`, not `404`:

```bash
curl -i https://your-hapi.example/companion/events
```

Run the full HAPI test suite and build because the patch changes the store schema, notification fan-out, route registration, and embedded PWA manifest. The preferred long-term outcome is a generic upstream contribution. Until then, a deployment using this patch is a maintained HAPI fork.


## v0.2 settings contract

`GET /companion/sessions` returns:

```json
{
  "capabilities": { "turnDuration": true },
  "sessions": [
    { "id": "example", "title": "Example session", "machineName": "My Mac", "updatedAt": 1788800000000, "active": true }
  ]
}
```

The namespace comes solely from the authenticated device; a caller-supplied namespace cannot select another user's catalog. Only ID, display title, optional host display name, update time and activity are projected. Title uses HAPI's `getSessionName`, preserving user naming/fallback conventions. No message content, full filesystem path, agent state or credentials are returned. Unavailable SyncEngine returns 503, invalid/disabled credentials return 401. The client requests this on opening settings or explicit refresh, without polling or adding another SSE stream. Older Hubs return 404; clients keep notifications working and explain the upgrade requirement.

Notification payload `version: 1` gains optional `durationMs`, a nonnegative safe integer. It measures the current foreground turn, using lifecycle-observed `activeTurnStartedAt`. New turn identities reset elapsed time even if thinking remains true. Completion freezes the value before any asynchronous channel dispatch; ended-state clearing and durable replay retain that value. Heartbeat timestamps, conversation age and client delivery time are never substituted. Unknown starts after restart remain absent. Permission events and unassociated background `task-notification` events omit duration; foreground `ready` events (including composed structured agent summaries) and generic `session-completed` events can carry it. No schema migration is added by v0.2; v0.1's schema v26 is unchanged.

## HAPI v0.30.7 compatibility changes

The event envelope remains contract version 1. Its `kind` vocabulary adds `input-request`, matching HAPI v0.30.7's distinction between a user question and a tool approval. This is additive; existing clients already decode `kind` as a string and continue to receive the title, summary, request ID and exact-session URL.

Schema v27 reconciles two different databases that both reported v26: pristine HAPI v0.30.7 contains the immediate-message queue index, while the prior Companion-patched line contains the Companion device/outbox tables. The idempotent v26→v27 migration ensures both sets exist and preserves device ACK cursors and queued events. Rollback must restore the pre-upgrade database backup with the prior binary; an older v26 binary must not be pointed at a v27 database.

The port preserves upstream Android, iOS and Web notification channels. Companion remains one additional durable channel and does not claim the native-delivery gate used by those channels.

### Linux shared Codex transport compatibility

The HAPI v0.30.7 shared runtime originally selected WebSocket-over-Unix-socket transport on every non-Windows platform. Bun 1.3.13 on Linux can terminate that connection immediately even though Codex app-server is listening, preventing Runner webhook startup from completing.

The cumulative patch now keeps Unix sockets on Darwin and selects authenticated loopback TCP on Linux and Windows. Both the direct control connection and gateway upstream use a fresh random capability token; the external gateway also persists its separate random token when its listener is TCP. No token value is logged. This changes neither the Companion HTTP contract nor schema v27.

`runtimeTransport.test.ts` fixes the platform matrix and token/persistence conditions. `runtimeTransport.linux.integration.test.ts` is an opt-in Linux gate that launches the installed real Codex app-server, connects over authenticated loopback TCP and completes the initialize round trip. Run it in an isolated Linux candidate with:

```bash
HAPI_RUN_LINUX_CODEX_TRANSPORT_TESTS=1 bun run --cwd cli test -- \
  src/codex/shared/runtimeTransport.linux.integration.test.ts
```

## v0.2 verification evidence

Validation used an isolated worktree at the baseline commit plus this cumulative patch; the reference source and running Hub were not modified. `bun install --frozen-lockfile` rejected the baseline lockfile under installed Bun, so `bun install` populated local dependencies. The incidental lockfile rewrite is excluded from the integration patch.

- `bun run typecheck`: all CLI/Web/Hub/Relay checks passed.
- `bun run build`: passed (CLI typecheck, Web bundle, embedded Web assets, Hub bundle).
- `bun run test`: CLI 2,412 passed / 1 skipped; Hub 1,216 passed / 3 skipped; Web 2,795 passed / 1 failed. The Web failure is `markdown-a.test.tsx` cross-tab StorageEvent construction with Node 25.9.0 global Web Storage. A clean baseline archive using the same dependencies reproduces the identical failure (77 passed / 1 failed); no Web runtime source is changed in this patch.
- With Node 25 global Web Storage disabled for the test process only, `NODE_OPTIONS=--no-experimental-webstorage bun run test:web`: all 2,796 Web tests passed (267 files); no source workaround was added.
- Remaining package suites were run separately after the root script stopped: shared 283 passed; relay 80 passed.
- Targeted integration/turn-tracker/store/migration tests: 27 passed. Includes namespace/device denial, minimal catalog and rename, same-thinking new turn, immutable duration through a suspended earlier channel, end ordering, unknown/background duration, and actual SSE replay retaining duration.
- `git apply --cached --check` against an isolated index loaded from clean baseline: passed. `git diff --check`: passed.

Evidence logs on the validation machine: `/tmp/hapi-companion-v02-hapi-{tests,typecheck,build}.log`, `/tmp/hapi-companion-v02-hub-full.log`, `/tmp/hapi-companion-v02-baseline-web-test.log`, `/tmp/hapi-companion-v02-web-compatible-node.log`, `/tmp/hapi-companion-v02-{shared,relay}.log`. Production endpoint availability, pairing and real macOS delivery still require the approved Hub deployment and device acceptance; this patch has not been deployed.

## HAPI v0.30.7 port verification evidence

Validation used an isolated worktree at exact tag commit `0239edf38e2da653d662f31039e24ccea04c7837`. `bun install --frozen-lockfile` completed, and `bun.lock` plus all package manifests remained byte-identical.

- Hub: 1,312 passed / 3 skipped; CLI: 2,802 passed / 7 skipped; Shared: 320 passed; Relay: 118 passed.
- Web: 3,182 passed / 1 failed. The sole `markdown-a.test.tsx` StorageEvent failure reproduces unchanged on the clean v0.30.7 baseline (77 passed / 1 failed in that file), so it is a baseline/runtime test-environment issue.
- Full `bun run typecheck` and `bun run build`: passed.
- Focused v26→v27 dual-lineage migration and input-request channel checks: 11 passed. The migration preserves the prior Companion ACK cursor and queued event while adding the upstream index.
- Clean re-apply and `git diff --check`: passed. The built PWA manifest contains `focus-existing` followed by `navigate-existing`.
- Companion doctor passed and 71 macOS client tests passed with no failures.
- No production service was changed. The new patch remains ineligible for production until the updater owner updates its pin and completes Linux candidate/VM gates.

## Linux transport hotfix verification evidence

Validation extended the cumulative patch on the same exact v0.30.7 baseline.

- Transport selection: 3 passed, covering Linux, Windows and Darwin. Linux/Windows require loopback TCP, an upstream token, a TCP gateway and persisted gateway token; Darwin retains Unix sockets without persisted token.
- Installed Codex shared-runtime integration on Darwin: 4 passed, confirming the unchanged Unix path.
- CLI: 2,805 passed / 8 skipped; Hub: 1,312 passed / 3 skipped; Shared: 320 passed; Relay: 118 passed.
- Web: 3,182 passed / 1 failed with the same baseline-reproduced `markdown-a.test.tsx` StorageEvent failure recorded above.
- Full typecheck and build passed.
- Companion doctor and 71 macOS client tests passed; no client contract changed.
- The new real Linux app-server gate is present but cannot run on the Darwin validation machine. The updater must run it with Codex CLI 0.154.0 or newer in the clean Linux candidate; a skipped test is not acceptance evidence.
- No API contract or database migration changes. Binary rollback does not require a DB downgrade because schema remains v27; retain the current known-good binary and normal database backup. Production replacement remains updater-owned.

## Patch change and upgrade handoff

These are required project rules, not an optional release checklist.

### Ownership and current pin

Companion maintains this patch, its contract and compatibility tests. The independent `hapi-safe-updater` project (`/Users/mayuming/develop/hapi-safe-updater`) maintains the upgrade implementation, patch pin, production gates and rollback execution. Updating the updater itself does not automatically change the patch pin.

On 2026-09-08 the updater owner reported the gates recorded on `feat/companion-patched-hub-gates`, pinning `2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd`. This is an owner-reported branch state, not independent evidence of merge or deployment. The updater repository is authoritative for its current installed state.

### Required steps when the patch changes

1. Record an executable task with the target HAPI baseline and acceptance criteria. Apply the patch to a clean, isolated checkout of that baseline; run the HAPI tests, type checks, build and relevant Companion contract/client tests. Record failures and limitations explicitly.
2. Compute `shasum -a 256 integrations/hapi/hapi-companion.patch`. Update this README's baseline/hash and relevant specification/release evidence. Bind the patch to an immutable, reviewable Companion commit; retain the prior known-good pin.
3. Explicitly notify the updater owner through the authorized project handoff channel. Include Companion commit, patch path, old/new SHA-256, target HAPI baseline, contract and migration changes (including “none”), verification results and rollback implications. Canonical coordination session: `854e7964-cd91-41a7-bfac-2a7e9e87787f` (“HAPI Safe Updater 管理”), with working directory `/Users/mayuming/develop/hapi-safe-updater`; use HAPI peer tools, never treat session URLs as filesystem paths.
4. Request the updater owner to update its pin and rerun the upgrade gates below. Record its acknowledgement, updater commit, acceptance evidence and merge/deployment status in the task. If the owner is unavailable or evidence is pending, retain the previous production pin and leave the integration task open. Sending the message alone does not complete the handoff.
5. Only report the changed integration ready for automatic production upgrade after the updater owner confirms the new pin and successful acceptance. Production changes still require applicable operator authorization.

A patch change requires a new hash even if its API contract is unchanged. A client-only change with an unchanged patch/contract needs no pin update. A new target HAPI version requires fresh compatibility acceptance even if the patch hash stays the same.

### Required upgrade gates (implemented by updater)

- Verify the pinned patch hash and exact source baseline before building in isolation. A missing patch, hash mismatch, failed application, failed tests or failed build blocks production replacement; never fall back to an unpatched upstream binary.
- Use a clean, pushed source commit; record source SHA, patch SHA, candidate binary SHA, target HAPI version, installed version and known-good rollback binary. Verify the actual backup filenames and hashes before stopping services. Keep a consistent database backup and assess migration compatibility; do not restore a database blindly when binary rollback suffices.
- Verify `/health` returns 200; unauthenticated `/companion/sessions` and `/companion/events` reject access with 401. Authenticated catalog must return JSON with the documented types and device namespace isolation, rather than accepting HTTP 200 alone (an HTML fallback is not success).
- Verify authenticated SSE returns `text/event-stream` and a `connected` first frame. A bounded `curl` probe may exit 28 because SSE remains open: accept this only when the required response and frame were verified. Timeout alone is never proof of health.
- Exercise completion delivery and explicit ACK using an isolated test device/event: authorized ACK advances the durable cursor, replay resumes correctly, and invalid/cross-device or cross-namespace ACKs are rejected. Do not consume or ACK the user's pending notifications as a test. Check optional `durationMs` and catalog capabilities against the client contract.
- Verify Hub and Runner are healthy after switching and Companion reconnects, loads real sessions and preserves its notification/click behavior. Keep automated checks and human sound/menu-bar/Edge acceptance statuses distinct.
- Fail closed before replacement; after replacement, failed required acceptance triggers rollback to the verified known-good binary and service checks. A preflight failure must not unnecessarily restart production. Record the first failed gate, rollback outcome and any remaining recovery task without credentials.

### Handoff evidence template

```text
Companion commit / patch path:
Previous patch SHA-256 / proposed patch SHA-256:
Target HAPI baseline / version:
Contract changes / migrations / rollback implications:
Tests, build and contract evidence:
Updater owner acknowledgement / commit:
Pin and upgrade gate results:
Merge / deployed version / rollback target:
Pending items / responsible owner:
```
