# HAPI Hub integration

The native app depends on a device-scoped, durable notification transport that upstream HAPI 0.29.0 does not currently expose. `hapi-companion.patch` contains the implementation used and tested by this project.

## Baseline

- Upstream: `https://github.com/tiann/hapi.git`
- Baseline commit: `d3d4fd1706564782e9a58b917df4e0677f65051f`
- Baseline description: HAPI `v0.29.0-2-gd3d4fd17`
- Patch schema level: database schema v26
- Updated for Companion v0.2: 2026-09-08
- Cumulative patch SHA-256: `2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd`

Because HAPI evolves, treat this patch as a reviewed reference rather than a timeless installer.

## Apply in a clean worktree

```bash
git clone https://github.com/tiann/hapi.git
cd hapi
git checkout d3d4fd1706564782e9a58b917df4e0677f65051f
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

## Patch change and upgrade handoff

These are required project rules, not an optional release checklist.

### Ownership and current pin

Companion maintains this patch, its contract and compatibility tests. The independent `hapi-safe-updater` project (`/Users/mayuming/develop/hapi-safe-updater`) maintains the upgrade implementation, patch pin, production gates and rollback execution. Updating the updater itself does not automatically change the patch pin.

On 2026-09-08 the updater owner reported the gates recorded on `feat/companion-patched-hub-gates`, pinning `2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd`. This is an owner-reported branch state, not independent evidence of merge or deployment. The updater repository is authoritative for its current installed state.

### Required steps when the patch changes

1. Record an executable task with the target HAPI baseline and acceptance criteria. Apply the patch to a clean, isolated checkout of that baseline; run the HAPI tests, type checks, build and relevant Companion contract/client tests. Record failures and limitations explicitly.
2. Compute `shasum -a 256 integrations/hapi/hapi-companion.patch`. Update this README's baseline/hash and relevant specification/release evidence. Bind the patch to an immutable, reviewable Companion commit; retain the prior known-good pin.
3. Explicitly notify the updater owner through the authorized project handoff channel. Include Companion commit, patch path, old/new SHA-256, target HAPI baseline, contract and migration changes (including “none”), verification results and rollback implications. Current coordination session: `cb66ab68-4731-42ce-98b0-8b0c2b721c74` (“HAPI 自动更新”); use HAPI peer tools, never treat session URLs as filesystem paths.
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
