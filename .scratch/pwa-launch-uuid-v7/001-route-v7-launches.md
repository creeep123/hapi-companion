---
title: Accept UUID v7 notification launches in the HAPI PWA
status: awaiting-updater-handoff
owner: Companion
version: V0.5 hotfix
specs:
  - docs/specs/V0_5_SOUNDS_AND_NAVIGATION.md
---

## Objective

Clicking a notification for a real UUID v7 session must route the already-open PWA to that exact session.

## Scope

Add a regression for a real v7 ID, expand the launch-handler UUID version check to RFC versions 1–8, regenerate the cumulative HAPI v0.30.7 patch and hand its new immutable hash to Safe Updater.

## Out of scope

No Hub API, DB migration, Mac client, Sidecar delivery, production deployment or updater implementation change.

## Acceptance criteria

- The v7 regression fails on the prior handler and passes on the fixed handler.
- Cross-origin, non-session, query-bearing and malformed UUID launches remain rejected.
- The cumulative patch applies cleanly to `0239edf38e2da653d662f31039e24ccea04c7837` with no package manifest or lockfile change.
- Root HAPI tests, typecheck and build pass; new patch SHA and immutable Companion commit are handed to the updater owner.
- Updater acknowledgement, pin/gate acceptance and production Web assets remain separately tracked.

## Verification

`bun run --cwd web test src/lib/pwaLaunchHandler.test.ts`; `NODE_OPTIONS=--no-experimental-webstorage bun run test`; `bun run typecheck`; `bun run build`; `git apply --check` from a clean HAPI v0.30.7 checkout; `shasum -a 256 integrations/hapi/hapi-companion.patch`.

## Evidence

The new targeted test failed twice before the handler fix (URL parser returned null; SPA router was not called), then passed. Root test, typecheck and build passed in a clean baseline plus patched checkout. The new patch SHA-256 is `0134292bf4f6dd2743bf17ad991c1be6ce61515041757447015ee97d67586c68`; the old production pin is `2e75aa3ce6eaf7d965639d48feff3f0dc7ff4352306b48a1c28de1a5d35f5757`.
