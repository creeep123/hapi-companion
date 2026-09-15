# Fix Linux shared Codex runtime transport on HAPI v0.30.7

Status: blocked on updater Linux candidate acceptance

## Scope

Extend the cumulative Companion patch on exact HAPI v0.30.7 commit `0239edf38e2da653d662f31039e24ccea04c7837` so Linux shared Codex runtimes use loopback TCP with a random upstream auth token, while Darwin retains Unix sockets.

## Acceptance

- Transport selection tests cover Linux, Windows and Darwin.
- Linux and Windows use a loopback TCP upstream plus random auth token; Darwin uses a Unix upstream without a token.
- Gateway listener endpoint/token persistence follows the same TCP-platform rule, while Darwin remains Unix.
- Existing shared-runtime behavior and Companion patch apply cleanly.
- Relevant tests, typecheck and build pass; a real Linux Codex app-server integration gate is supplied or its environment limitation is documented.
- Production remains unchanged. New patch hash and immutable commit are handed to Safe Updater for pin and candidate gates.

## Companion evidence

- Proposed cumulative patch SHA-256: `2e75aa3ce6eaf7d965639d48feff3f0dc7ff4352306b48a1c28de1a5d35f5757`.
- Transport matrix tests: 3 passed.
- Existing installed-Codex shared runtime integration on Darwin: 4 passed.
- CLI 2,805 passed / 8 skipped; Hub 1,312 passed / 3 skipped; Shared 320 passed; Relay 118 passed.
- Web 3,182 passed / 1 baseline-reproduced StorageEvent failure; full typecheck and build passed.
- Clean apply/frozen install passed with lock and package manifests unchanged; Companion doctor and 71 macOS tests passed.
- Real Linux Codex app-server integration gate was added and must be run by Updater in its isolated Linux candidate; the Darwin run skips it by design.
- Contract and DB schema are unchanged. Binary rollback remains compatible with DB v27.
