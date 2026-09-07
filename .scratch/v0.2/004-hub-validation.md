---
title: V0.2 Hub integration validation evidence
status: ready-for-human
owner: hub-implementation
version: V0.2
---

# Result

Locally verified cumulative Hub patch. This record verifies implementation/test/build evidence; it does not claim deployment, production endpoint availability, macOS UI acceptance, or independent implementation-review completion.

- Baseline: `d3d4fd1706564782e9a58b917df4e0677f65051f`.
- Isolated source: `.build/hapi-v02`.
- Artifact: `integrations/hapi/hapi-companion.patch`.
- SHA-256: `2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd`.
- Aggregate unique package test result: **6,787 passed, 4 skipped**. Targeted and rerun tests below are already included; do not add them again.

# Commands and results

All package commands ran from the isolated source root.

| Command | Verified result | Log |
| --- | --- | --- |
| `bun run test` | CLI 2,412 passed / 1 skipped; Hub 1,216 passed / 3 skipped; Web 2,795 passed / 1 failed; root script stopped at Web | `/tmp/hapi-companion-v02-hapi-tests.log` |
| `NODE_OPTIONS=--no-experimental-webstorage bun run test:web` | 2,796 passed; 267 files | `/tmp/hapi-companion-v02-web-compatible-node.log` |
| `bun run test:shared` | 283 passed; 25 files | `/tmp/hapi-companion-v02-shared.log` |
| `bun run test:relay` | 80 passed; 5 files | `/tmp/hapi-companion-v02-relay.log` |
| `bun run test:hub` | 1,216 passed / 3 skipped; 99 files | `/tmp/hapi-companion-v02-hub-full.log` |
| `bun run typecheck` | CLI, Web, Hub, Relay all completed; exit 0 | `/tmp/hapi-companion-v02-hapi-typecheck.log` |
| `bun run build` | CLI typecheck, Web, embedded assets, Hub completed; exit 0 | `/tmp/hapi-companion-v02-hapi-build.log` |
| `bun test hub/src/notifications/turnDurationTracker.test.ts hub/src/notifications/notificationHub.test.ts hub/src/web/routes/companion.test.ts hub/src/store/companionNotificationStore.test.ts hub/src/store/migration-v25.test.ts` | 27 passed | `/tmp/hapi-companion-v02-hub-targeted.log` |
| `bun test hub/src/web/routes/companion.test.ts` | 8 passed, including actual SSE duration replay | `/tmp/hapi-companion-v02-hub-replay.log` |

The original Web failure is `markdown-a.test.tsx > cross-tab sync via storage event > updates after storage event fires (simulated other-tab write)`: Node 25.9.0 global Web Storage is not a jsdom Storage instance. An archive of the clean baseline using the same installed dependencies reproduced the identical failure (77 passed / 1 failed): `/tmp/hapi-companion-v02-baseline-web-test.log`. Disabling Node's experimental global Web Storage for the test process makes the full Web suite pass. No runtime source workaround or deployment configuration was added.

Dependency bootstrap: frozen Bun install rejected the baseline lockfile; `bun install` succeeded in the isolated tree. Its incidental `bun.lock` rewrite is excluded from the patch. Logs: `/tmp/hapi-companion-v02-hapi-install.log`, `/tmp/hapi-companion-v02-hapi-install-retry.log`.

# Artifact verification

A final independent evidence pass reread the complete log files and extracted package summary counts. It also performed these inexpensive artifact checks without repeating passed full suites:

1. SHA-256 matches the value above.
2. Load baseline into a temporary index with `GIT_INDEX_FILE=<temporary-index> git read-tree d3d4fd1706564782e9a58b917df4e0677f65051f`; `git apply --cached --check <absolute-patch>` succeeds against that clean index.
3. Patch bytes exactly equal `git diff --binary -- . ':!bun.lock'` from the isolated implementation worktree.
4. Isolated implementation `git diff --check` succeeds. Outer-repository whitespace checks may flag single-space blank context lines inside the patch; these are valid unified-diff context.
5. Cumulative patch sections for `hub/src/store/index.ts` and `hub/src/store/companionNotificationStore.ts` are byte-identical to the v0.1 patch at parent repository HEAD. **No v0.2 schema or store migration delta**; schema remains v26. The payload's optional duration is JSON. Existing device credential/authentication model remains unchanged.

# Coverage and limits

Automated evidence covers minimal authenticated session catalog, namespace isolation, disabled/invalid devices, unavailable catalog, rename-stable IDs, same-thinking new turn identity, immutable duration before asynchronous channel dispatch, inactive-update/end ordering, repeated turns, unknown start, unassociated background task duration, durable payload and actual SSE replay. Existing replay/ACK/security regression tests remain included.

Changed source is restricted to the isolated worktree and the repository integration patch/README. The reference source working files and live Hub were not modified; no commit or deployment was made in the Hub tree. Integration review, real Hub installation, and native macOS UI/sound/deep-link acceptance remain separate gates owned by the parent implementation workflow.
