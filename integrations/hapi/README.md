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
