# V0.6 official-HAPI Sidecar

Status: implementation in progress

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
- [x] Resolve independent architecture/security/client review findings (final review PASS, 2026-09-16).
- [ ] Implement official source adapter and fixtures.
- [ ] Implement interpreter and gap reconciliation.
- [ ] Implement durable store and independent consumers.
- [ ] Migrate Mac transport binding without losing settings.
- [ ] Complete unit, component, failure and clean-HAPI integration gates.
- [ ] Update operations, rollback, upgrade and patch-retirement documentation.
- [ ] Prepare a clean, reviewable candidate; do not deploy without explicit approval.
