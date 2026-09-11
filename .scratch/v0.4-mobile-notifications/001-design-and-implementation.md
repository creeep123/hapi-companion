---
title: V0.4 Android exact-session notifications
status: implementing
owner: engineering
version: V0.4
specs:
  - docs/specs/V0_4_ANDROID_NOTIFICATIONS.md
  - docs/adr/0005-mobile-notification-relay.md
---

Objective: ship reliable Android completion notifications that open the exact HAPI PWA session while the Mac may be asleep.

Acceptance: V0.4 A1–A15, independent product/design/engineering/security review with no unresolved blockers, implementation review, local and clean-HAPI validation, then human production/phone gates only when required.

Constraints: public ntfy.sh first; no response body; one relay SSE and explicit ACK; no polling; do not add updater implementation; every patch change requires SHA/pin handoff and upgrade acceptance.

Progress:

- 2026-09-11: OPPO Find X9 Pro / ColorOS 16.0.10 received an ntfy delayed notification; tapping it opened the exact HAPI Chrome PWA session.
- 2026-09-11: feature branch created; first product/technical spec and proposed ADR drafted for expert review.
- First expert review found blockers in onboarding/pairing, ACK ordering, disclosure, click construction, quiet-mode claims and VM operations. The design was revised to reuse existing Hub APIs with no patch change, register only after phone confirmation, process strict sequence order and add an executable evidence/runbook contract.
- Second product review found pause semantics undefined; pause now consumes and terminally suppresses events so resume never bursts old notifications.
- Second architecture review found cross-service activation could not be atomic; it is now an idempotent saga with stable IDs, unknown-outcome recovery and compensating Hub deletion.
- Final product and architecture reviews report no blockers; test/operations review reports no blockers and retained implementation-time P1 gates for API schemas, state layout, shutdown behavior and Linux packaging.

Next: implement Relay core/operations and Mac control surface, then run independent implementation review and full acceptance gates.
