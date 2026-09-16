# V0.6 official-HAPI Sidecar

Status: implementation candidate under final independent review

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
- [ ] Resolve independent architecture/security/client review findings; initial review findings are implemented and final re-review is pending.
- [x] Implement official source adapter and fixtures.
- [x] Implement interpreter and gap reconciliation.
- [x] Implement durable store and independent consumers.
- [x] Migrate Mac transport binding without losing settings.
- [x] Complete unit, component, failure and clean-HAPI integration gates.
- [x] Update operations, rollback, upgrade and patch-retirement documentation.
- [ ] Prepare a clean, reviewable candidate; do not deploy without explicit approval.

## Current evidence

- Clean official HAPI checkout: `0239edf38e2da653d662f31039e24ccea04c7837`; 116 upstream route/replay/namespace tests and the real auth/namespace/catalog/SSE process gate pass.
- Relay: 147 tests plus TypeScript pass after the second review fixes, including serialized cutover, auxiliary SQLite path rejection and content-free shadow reporting.
- Mac: 75 tests pass; probe-before-save, failed-probe rollback and replaced-consumer revocation are covered.
- Candidate bundle: `0.6.0-alpha.1`; Linux x64 package smoke passes. Local candidate evidence: archive SHA-256 `c33db39459fb413f7bd318580dae0e15150d5323c89b8fcfee352c905f4afae6`, binary SHA-256 `b030b609e9fc3da2a7cc407068e75467a6977b7aad562ad7135d0a9f48a75057`.
- Production remains on the patched path. Real Mac/OPPO and shadow comparison require separately authorized deployment.
