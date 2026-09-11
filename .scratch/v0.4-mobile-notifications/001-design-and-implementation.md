---
title: V0.4 Android exact-session notifications
status: production-acceptance
owner: engineering
version: V0.4
specs:
  - docs/specs/V0_4_ANDROID_NOTIFICATIONS.md
  - docs/adr/0005-mobile-notification-relay.md
---

Objective: ship reliable Android completion notifications that open the exact HAPI PWA session while the Mac may be asleep.

Acceptance: V0.4 A1–A15, independent product/design/engineering/security review with no unresolved blockers, implementation review, local and clean-HAPI validation, then human production/phone gates only when required.

Constraints: public ntfy.sh first; fixed content by default and event title/summary only after separate opt-in; one relay SSE and explicit ACK; no polling; do not add updater implementation; every patch change requires SHA/pin handoff and upgrade acceptance.

Progress:

- 2026-09-11: OPPO Find X9 Pro / ColorOS 16.0.10 received an ntfy delayed notification; tapping it opened the exact HAPI Chrome PWA session.
- 2026-09-11: feature branch created; first product/technical spec and proposed ADR drafted for expert review.
- First expert review found blockers in onboarding/pairing, ACK ordering, disclosure, click construction, quiet-mode claims and VM operations. The design was revised to reuse existing Hub APIs with no patch change, register only after phone confirmation, process strict sequence order and add an executable evidence/runbook contract.
- Second product review found pause semantics undefined; pause now consumes and terminally suppresses events so resume never bursts old notifications.
- Second architecture review found cross-service activation could not be atomic; it is now an idempotent saga with stable IDs, unknown-outcome recovery and compensating Hub deletion.
- Final product and architecture reviews report no blockers; test/operations review reports no blockers and retained implementation-time P1 gates for API schemas, state layout, shutdown behavior and Linux packaging.

- 2026-09-11: Relay core, strict API, durable state/ledger, packaging, systemd installation and runbook implemented. Relay typecheck, unit tests, fake-provider smoke and self-contained Linux x64 package smoke pass.
- 2026-09-11: Mac Relay pairing, phone onboarding, QR/copy fallback, real-session test, activation/pause/remove/repair/resume, shared rule sync and status UI implemented. The full macOS test suite passes.
- 2026-09-11: Final implementation review found one activation-cleanup blocker plus contract/operations hardening items. Remediation and regression tests followed before declaring a deployable candidate.

- 2026-09-11: all implementation-review P0/P1 findings closed. Final independent review reports P0=0/P1=0. Root verification passes 67 Mac tests, universal/ad-hoc Release packaging, 84 Relay tests, fake-provider smoke, Linux x64 self-contained bundle smoke, unchanged Hub patch hash and diff checks.

- 2026-09-12: production v0.4.0 Relay is healthy and the OPPO receives notifications whose tap opens the exact HAPI PWA session. The user requested matching Mac notification content. V0.4.1 adds a capability-gated, per-Hub, explicit opt-in for sanitized event title/summary while preserving fixed text as the safe default. Conflict recovery retains both enable and privacy-off intent across restarts. Independent final review and immutable production upgrade evidence remain pending.

Next: close final review, commit and push v0.4.1, rebuild immutable artifacts, upgrade Relay and Mac, then verify one real matching-content phone notification.
