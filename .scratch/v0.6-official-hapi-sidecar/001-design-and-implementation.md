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
- Relay: 148 tests plus TypeScript pass after the final review fixes, including serialized cutover, auxiliary SQLite path rejection, content-free shadow reporting and its service-user permission model.
- Mac: 75 tests pass; probe-before-save, failed-probe rollback and replaced-consumer revocation are covered.
- Candidate bundle: `0.6.0-alpha.2`; Linux x64 package smoke passes. Local candidate evidence: archive SHA-256 `f413662f41c8696844fff6c61081df1a5c63b94f950d386477b3b6e0ca2f5125`, binary SHA-256 `aa52daf95e269e7b246375384c53c957ae335c2e497cea0b6be9b1ab6f17fab1`.
- Independent final review: READY, P0/P1 zero. It confirms the Sidecar is isolated from the live Relay and that the shadow report can run under the deployed ownership model without exposing notification content or credentials.
- Production shadow was authorized and started on 2026-09-16 from canonical `main` `718ce34cddffda7d406854f9d938b907f7621e64`. The immutable alpha.2 archive/binary hashes are recorded above. It binds only to `127.0.0.1:8791`; the live Relay remains healthy on 8789 and the existing Nginx ingress retains 8790. No public Sidecar route or client binding was added.
- The first alpha.1 start failed closed because Linux systemd exposes `LoadCredential` through a root-owned read-only 0550/0440 mount. The service was immediately stopped and disabled while the live Relay remained active. PR #27 added the narrowly scoped credential-mount check, independent review returned READY with no P0/P1, and alpha.2 then started successfully.
- Initial production evidence: official source state `live`, schema 2, catalog snapshot present, source cursor present, zero restarts, real `ready` observations recorded, and zero delivery rows. Current memory was about 44 MB (63 MB observed peak), private Sidecar state occupied 4.3 MB, and existing Relay health passed. Five-kind semantic comparison, controlled gap/restart recovery and longer resource soak remain shadow gates before any cutover discussion.
