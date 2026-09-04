# V0 Baseline Spec

## Purpose

Publish the existing working HAPI Companion prototype as a reproducible, agent-installable standalone project without weakening its delivery, credential, or exact-session guarantees.

## In Scope

- standalone macOS source, tests, resources, and XcodeGen project definition;
- Agent-first README and environment doctor;
- dynamic Hub/PWA discovery with no personal domain or Edge app ID in source;
- documented HAPI 0.29.0 Hub integration patch and API contract;
- Control Panel, architecture, contribution, security, and rollback documentation;
- unique GitHub repository under the owner's account;
- selected visual identity and complete app/menu-bar asset package.

## Out of Scope

- mobile clients, general notification aggregation, hosted services;
- automatic Hub deployment;
- Developer ID signing and notarization;
- browsers other than the documented Edge path.

## Acceptance Criteria

- [x] `docs/management/CONTROL_PANEL.md` reflects the product and trust boundaries.
- [x] Canonical local build/test commands are documented.
- [x] Exactly one canonical integration branch (`main`) is recorded.
- [x] HAPI patch baseline, migration level, rollback requirements, and API contract are recorded.
- [x] Sensitive systems are mapped without exposing secrets.
- [x] Doctor and all seven unit tests pass from a fresh clone of remote `main`.
- [ ] Patch applies cleanly to the documented HAPI baseline and targeted/full tests pass.
- [ ] Brand direction is selected and the complete asset package passes visual checks.
- [ ] A clean commit is pushed to and read back from `creeep123/hapi-companion`.

## Suggested Verification

```bash
./scripts/doctor.sh
xcodegen generate
xcodebuild -project HapiCompanion.xcodeproj -scheme HapiCompanion \
  -destination 'platform=macOS' -derivedDataPath .build \
  CODE_SIGNING_ALLOWED=NO test
```
