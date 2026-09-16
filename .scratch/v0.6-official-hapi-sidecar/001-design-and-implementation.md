# V0.6 official-HAPI Sidecar

Status: production shadow active; semantic comparison and restart/resource soak in progress

## Outcome

Replace Companion's runtime dependency on a locally patched HAPI Hub with a Companion-owned Sidecar that consumes official HAPI REST/SSE. Hub-restart gaps may lose a transient notification; once the Sidecar observes an event, downstream delivery remains durable with explicit consumer ACK and replay.

## Required deliverables

- Complete technical specification and ADR grounded in HAPI v0.30.7 official interfaces.
- Independent architecture/security/client review with findings resolved.
- Official-HAPI upstream adapter, event inference, gap reconciliation, durable downstream outbox and independent Mac/mobile consumers.
- Mac transport migration preserving settings, notification behavior and exact-session navigation.
- Deployment, upgrade, rollback and patch-retirement documentation.
- Unit, contract, failure, compatibility, package and client tests.
- No production deployment until an explicit production authorization and human acceptance gate.

## Design artifacts

- `docs/specs/V0_6_OFFICIAL_HAPI_SIDECAR.md`
- `docs/adr/0008-official-hapi-sidecar.md`

## Accepted product boundary

The product owner accepts that an official HAPI restart may hide a transient event that begins and ends while the upstream in-memory replay window is unavailable. This does not weaken Sidecar durability after observation: canonical commit, Mac ACK/replay and mobile delivery remain independent and durable within their documented provider limits.

## Execution checklist

- [x] Inspect official HAPI v0.30.7 REST/SSE behavior.
- [x] Inspect existing Mac and Mobile Relay coupling.
- [x] Draft complete technical specification and ADR.
- [x] Resolve independent architecture/security/client review findings; final review at `61cda4de3bab925e0f30ba33bedc9719f948d4ec` is READY with no P0/P1 findings.
- [x] Implement official source adapter and fixtures.
- [x] Implement interpreter and gap reconciliation.
- [x] Implement durable store and independent consumers.
- [x] Migrate Mac transport binding without losing settings.
- [x] Complete unit, component, failure and clean-HAPI integration gates.
- [x] Update operations, rollback, upgrade and patch-retirement documentation.
- [x] Prepare a clean, reviewable candidate; do not deploy without explicit approval.

## Current evidence

- Clean official HAPI checkout: `0239edf38e2da653d662f31039e24ccea04c7837`; 116 upstream route/replay/namespace tests and the real auth/namespace/catalog/SSE process gate pass.
- Relay: 156 tests plus TypeScript pass after the final review fixes, including serialized cutover, auxiliary SQLite path rejection, content-free shadow reporting, non-semantic patch filtering and bounded cursor batching.
- Mac: 75 tests pass; probe-before-save, failed-probe rollback and replaced-consumer revocation are covered.
- Candidate bundle: `0.6.0-alpha.4`; Linux x64 package smoke passes. Local candidate evidence: archive SHA-256 `8813d55f2cf82224404841dbeb93f850c8d2f1600ff0a4423cc4ca792fbd219c`, binary SHA-256 `4597ec189365d402417b981ee6dff428017cd017bb6832a9f1847ede74317bda`.
- Independent final review: READY, P0/P1 zero. It confirms the Sidecar is isolated from the live Relay and that the shadow report can run under the deployed ownership model without exposing notification content or credentials.
- Production shadow was authorized and started on 2026-09-16. It now runs reviewed alpha.4 from canonical `main` `8b739d51a35a02009c9c3747206ea96ea8ddc0cb`; its immutable archive/binary hashes are recorded above. It binds only to `127.0.0.1:8791`; the live Relay remains healthy on 8789 and the existing Nginx ingress retains 8790. No public Sidecar route or client binding was added.
- The first alpha.1 start failed closed because Linux systemd exposes `LoadCredential` through a root-owned read-only 0550/0440 mount. The service was immediately stopped and disabled while the live Relay remained active. PR #27 added the narrowly scoped credential-mount check, independent review returned READY with no P0/P1, and alpha.2 then started successfully.
- Initial production evidence: official source state `live`, schema 2, catalog snapshot present, source cursor present, zero restarts, real `ready` observations recorded, and zero delivery rows. Current memory was about 44 MB (63 MB observed peak), private Sidecar state occupied 4.3 MB, and existing Relay health passed. Five-kind semantic comparison, controlled gap/restart recovery and longer resource soak remain shadow gates before any cutover discussion.
- The production HMAC shadow-report command passed under the deployed service-user ownership model. Its output had version 1, a numeric high-water mark and only aggregate `ready` observations; forbidden content/credential field names were absent, and the temporary key/report were removed immediately.
- A Sidecar-only controlled restart returned the official source to `live`, kept attention clear and delivery rows at zero, advanced from the durable upstream cursor, and left the legacy Relay active. A production Hub restart remains intentionally untested because it can disrupt active sessions and requires its own maintenance authorization.
- The first production parity sample matched all 34 patched-Hub `ready` notifications after the cold-start boundary, with zero patched-only events. The Sidecar had one additional observation inside its first 30 seconds, which is classified as a baseline-window artifact pending the longer comparison. Matched observation-time delta was 186 ms median and 4.154 s maximum; no session identifiers or content were emitted during comparison.
- The subsequent two-hour parity sample matched all 31 patched-Hub `ready` notifications with zero observations unique to either path. Observation-time delta was 175 ms median, 1.7 s p95 and 3.41 s maximum. The comparison emitted counts and timing only.
- Initial steady-state measurement found about 2.45% of one CPU core, 154 KB/s of writes and 83 write calls/s, above the documented CPU budget. Alpha.3 stopped full-detail/catalog refreshes for allowlisted non-semantic patches; alpha.4 additionally batches their durable cursor/catalog commits while semantic and unknown patches remain fail-closed. Independent review of both changes ended READY with no P0/P1/P2 findings. Two consecutive alpha.4 samples measured about 1.00% and 0.83% CPU (0.92% combined), about 20 KB/s and 9.3 write calls/s, 68 MB RSS and 4.4 MB database plus WAL. Longer soak remains open.
- Historical patched-outbox counts explain the current kind distribution: the prior 30 days contain 1 input request, 7 permission requests and 1,576 ready notifications, with no task-notification or session-completed events. Shadow therefore continues until the next natural input/permission events can be compared; task/completion remain covered by official-shaped interpreter fixtures unless a real production occurrence becomes available.
