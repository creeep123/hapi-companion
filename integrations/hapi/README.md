# HAPI Hub integration

The native app depends on a device-scoped, durable notification transport that upstream HAPI 0.29.0 does not currently expose. `hapi-companion.patch` contains the implementation used and tested by this project.

## Baseline

- Upstream: `https://github.com/tiann/hapi.git`
- Baseline commit: `d3d4fd1706564782e9a58b917df4e0677f65051f`
- Baseline description: HAPI `v0.29.0-2-gd3d4fd17`
- Patch schema level: database schema v26
- Captured: 2026-09-04

Because HAPI evolves, treat this patch as a reviewed reference rather than a timeless installer.

## Apply in a clean worktree

```bash
git clone https://github.com/tiann/hapi.git
cd hapi
git checkout d3d4fd1706564782e9a58b917df4e0677f65051f
git apply --check /path/to/hapi-companion/integrations/hapi/hapi-companion.patch
git apply /path/to/hapi-companion/integrations/hapi/hapi-companion.patch
pnpm install
pnpm test
pnpm build
```

Before deployment, back up the Hub database and record the current executable/container as the rollback target. Deploy the fully built Hub and embedded web assets together. The migration is forward-only, so rolling back the binary may also require restoring the database backup.

## API contract

- `POST /api/companion/devices/register`: normal HAPI user JWT; exchanges a stable local installation ID for a device-scoped token.
- `GET /companion/events`: device token plus `X-Hapi-Device-Id`; streams durable SSE events after the device ACK cursor.
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
