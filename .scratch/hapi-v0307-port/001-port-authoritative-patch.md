# Port the Companion Hub integration to HAPI 0.30.7

Status: blocked on updater pin and candidate acceptance

## Scope

Rebase the authoritative cumulative Hub/PWA patch from the reviewed HAPI 0.29.0 baseline onto upstream HAPI 0.30.7 commit `0239edf38e2da653d662f31039e24ccea04c7837` without changing production systems. The contract-v1 `kind` vocabulary gains the additive upstream `input-request` value.

## Constraints

- Preserve one durable SSE stream and explicit ACK; do not add polling.
- Preserve device and namespace isolation, replay ordering, bounded paging, pruning, duration semantics, session catalog and strict same-origin PWA launch handling.
- Allocate a new schema migration after inspecting the upstream 0.30.7 schema. Never overwrite or reuse an upstream migration number.
- Keep the result as one clean cumulative patch against the exact upstream commit.
- Do not modify `hapi-safe-updater`; hand off the immutable Companion commit and new patch SHA only after acceptance.
- Do not modify or restart production.

## Acceptance criteria

1. The exact upstream commit and version are recorded and `git apply --check` passes on a clean checkout.
2. Schema and migration behavior pass fresh, legacy and current-version tests; downgrade implications are documented.
3. Companion routes, authentication, catalog, SSE connected frame, durable replay, ACK validation, namespace isolation and duration behavior pass focused tests.
4. CLI, Hub, Web, Shared and Relay suites plus typecheck and production build pass, with any upstream-only failure reproduced and documented.
5. PWA Launch Handler tests pass and the built manifest contains the intended `focus-existing` behavior.
6. The cumulative patch SHA-256 and immutable Companion commit are recorded in integration docs and the Control Panel.
7. The Updater owner acknowledges the new pin, candidate acceptance and rollback evidence before any production window is approved.

## Companion acceptance evidence

- Proposed patch SHA-256: `f7492b0fb2614f0963c473007b1c3910eab80aa04bb2ab44dc96613fa8c5dd5b`.
- Clean apply and frozen-install manifest invariant: passed.
- Hub 1,312 passed / 3 skipped; CLI 2,802 passed / 7 skipped; Shared 320 passed; Relay 118 passed.
- Web 3,182 passed / 1 baseline-reproduced StorageEvent failure.
- Full typecheck and build passed; built manifest contains the required launch handler.
- Doctor and 71 macOS client tests passed.
- Production remains unchanged and NO-GO. Updater pin, Linux candidate, VM gates, rollback rehearsal and later real notification acceptance remain owned by the updater handoff.

## Verification

```text
git apply --check integrations/hapi/hapi-companion.patch
bun run test
bun run typecheck
bun run build
./scripts/doctor.sh
xcodebuild -project HapiCompanion.xcodeproj -scheme HapiCompanion -destination 'platform=macOS' -derivedDataPath .build CODE_SIGNING_ALLOWED=NO test
```
