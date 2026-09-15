# Fix Linux shared Codex runtime transport on HAPI v0.30.7

Status: in progress

## Scope

Extend the cumulative Companion patch on exact HAPI v0.30.7 commit `0239edf38e2da653d662f31039e24ccea04c7837` so Linux shared Codex runtimes use loopback TCP with a random upstream auth token, while Darwin retains Unix sockets.

## Acceptance

- Transport selection tests cover Linux, Windows and Darwin.
- Linux and Windows use a loopback TCP upstream plus random auth token; Darwin uses a Unix upstream without a token.
- Gateway listener endpoint/token persistence follows the same TCP-platform rule, while Darwin remains Unix.
- Existing shared-runtime behavior and Companion patch apply cleanly.
- Relevant tests, typecheck and build pass; a real Linux Codex app-server integration gate is supplied or its environment limitation is documented.
- Production remains unchanged. New patch hash and immutable commit are handed to Safe Updater for pin and candidate gates.
