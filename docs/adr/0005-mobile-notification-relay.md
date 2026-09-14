# ADR 0005 — VM relay for mobile notification delivery

Date: 2026-09-11. Status: accepted after independent product, architecture/security and test/operations review.

## Context

The Mac app's reminder rules and delivery cursor are local. Sending ntfy requests from it would stop mobile reminders whenever that Mac sleeps. Sending directly from the Hub would couple a third-party provider and user policy to the maintained HAPI patch, and would replace the existing device SSE/ACK reliability boundary with provider-specific behavior.

The user approved a lightweight first release using public ntfy.sh, a VM component, QR onboarding and the current reminder rules. An OPPO/ColorOS device has already demonstrated notification receipt and exact-session PWA opening through ntfy's click action.

## Decision

Add a headless Mobile Relay owned by this repository and run it on the Hub VM. Treat it as an independent Companion device: one authenticated SSE, local policy evaluation, an HTTPS ntfy post and explicit Hub ACK after accepted delivery. The Mac app is its control surface but never participates in event forwarding.

Use a narrow relay management API protected by a ≥128-bit, ten-minute, single-use VM bootstrap code and a hashed relay-scoped management bearer. The Mac keeps the bearer and ntfy topic in Keychain. After phone test confirmation, the Mac uses its existing CLI-auth flow and the existing Hub device registration endpoint, then activates the Relay through a persisted, stable `activationId` saga. Same-ID retries are idempotent; explicit rejection compensates by deleting the Hub device; unknown outcomes are queried/retried before deletion. No HAPI patch change is planned; if existing registration/deletion proves insufficient, stop for a new architecture review before changing the patch. No ntfy provider code belongs in HAPI.

The Relay processes one event at a time in sequence. It durably records provider acceptance or intentional suppression before ACK; any failed head event stops later processing. It always rebuilds the click URL from the immutable configured HAPI HTTPS origin and encoded session ID. Public ntfy receives fixed product text by default. A receiver may separately opt in to forwarding the validated HAPI event title and summary after the Relay advertises that capability; this choice is revisioned, scoped to the Hub origin and never enabled by migration or the original pairing consent.

V0.4 supports one phone and public ntfy.sh by default. The base URL remains configurable for later self-hosting. Fixed mode sends only product text and the validated same-origin HAPI session URL. Event-preview mode sends only the event title and summary after deterministic Unicode cleanup and byte limits; it never forwards the event URL or other event fields and never stores notification content in Relay state, ledger, health or logs.

## Consequences

Mobile delivery continues while the Mac sleeps and preserves the existing durable SSE/ACK model without changing the HAPI patch or updater pin. The VM gains one small service and an HTTPS management surface that require packaging, health checks, upgrade/rollback and credential handling. Rule and content-mode changes synchronize explicitly from one controlling Mac with revisions, capability negotiation and visible split state. Event preview expands third-party disclosure only for users who explicitly accept it; disabling it affects future posts and cannot retract provider or handset history. Delivery is at least once: exactly-once handset display remains impossible across ntfy's accepted-request boundary.

If implementation reconnaissance proves the management surface or related-device provisioning materially larger than direct Hub delivery, engineering review must return this ADR to proposed status and compare both designs before code proceeds.
