# ADR 0008: Observe official HAPI from a Companion Sidecar

**Status:** accepted for implementation; production cutover pending
**Date:** 2026-09-16

## Context

The current Mac and mobile notification paths consume a Companion API added to HAPI by `integrations/hapi/hapi-companion.patch`. That patch provides durable outbox, device credentials, catalog, SSE and explicit ACK, but every upstream HAPI release requires a source rebase, schema reconciliation, full candidate build and coordinated updater pin.

HAPI v0.30.7 already exposes namespace-filtered session REST APIs, a global authenticated SSE stream, message pages and exact session identifiers. Its replay buffer is process-local and does not provide external consumer ACKs. The product owner accepts that ready/task events outside available replay can be missed after a gap.

## Decision

Build a Companion-owned Sidecar that consumes one official HAPI SSE connection per namespace and uses official REST calls to enrich and reconcile session state. Convert proven transitions into the existing version 1 Companion event contract and transactionally store them in a Sidecar-owned SQLite outbox. Deliver to Mac and ntfy through independent consumers and cursors.

On `resume=gap`, establish a current-state baseline from catalog and required session details while buffering new SSE frames. Recover pending input/permission requests from that state, clear legacy message watermarks, and apply buffered frames in order using their official SSE IDs. Do not scan message history for old ready/task events; this keeps recovery bounded for arbitrarily long sessions and makes the accepted loss boundary explicit.

Keep the public HAPI PWA origin separate from the Sidecar API origin. Rebuild exact session URLs from the trusted public origin. Keep the namespace-scoped HAPI access token only on the VM; give clients scoped Sidecar tokens.

Use the current patch path during development and shadow verification. Cut over with a single-source barrier; never send from patched and Sidecar paths concurrently. Patch retirement requires separate production authorization and Safe Updater changes.

## Why

This removes routine source-level coupling to HAPI releases while retaining live delivery and durable behavior after observation. A dedicated source/interpreter/store boundary localizes the remaining compatibility work to official API semantics. Independent consumers prevent a phone provider outage from delaying Mac alerts, or a sleeping Mac from delaying phone alerts.

SQLite supplies the atomic relationship between source cursor, semantic deduplication, canonical event and per-consumer delivery. The prior JSON ledger cannot safely express independent cursors and rewrites the whole state file per event.

The existing `0600` JSON store remains for low-frequency management and ntfy configuration, including the write-only topic. This keeps deployed pairing/configuration compatible and avoids a secret-copy migration. SQLite replaces only the event ledger, source cursor, catalog and per-consumer delivery state; those values share the transactions that require atomicity.

The official source credential is installed only through a VM-local operation. Public pairing creates management and scoped consumer credentials; it cannot provision or reveal the HAPI token. Existing v1 Relay activation remains a legacy patched-mode protocol and is rejected with an upgrade-required response after official mode is active.

## Consequences

- Official HAPI packages can be upgraded directly when the Sidecar black-box compatibility gate passes.
- Companion owns a small server process and schema independently of HAPI.
- The VM must hold a high-privilege namespace token because HAPI has no read-only notification credential.
- Canonical title/body are persisted for bounded offline replay; raw messages and transcripts are not.
- Replay expires after 35 days and inactive consumer leases expire after 45 days, keeping storage bounded and making long-offline data loss explicit.
- Reaching the storage ceiling closes the official stream at the last committed cursor until checkpoint/retention recovery succeeds; frames are never accumulated in memory.
- A HAPI replay gap can hide a ready/task event even when its message remains in history; current pending input/permission requests are still recovered from session state.
- HAPI event semantic changes may require an adapter update even when schemas remain syntactically compatible.
- The existing Mobile Relay becomes the operational base, but its serial engine is replaced rather than extended.

## Alternatives considered

### Keep rebasing the HAPI patch

This has the strongest source-side durability but retains the recurring upgrade coupling and schema conflict risk that this change is intended to remove.

### Connect the Mac directly to official HAPI SSE

This exposes a high-privilege HAPI token to every Mac, duplicates inference and gap logic across clients, provides no durable offline outbox, and does not solve Android delivery.

### Tail the HAPI database or logs

This binds Companion to private storage formats, increases privilege, risks partial reads, and is harder to secure and upgrade than the public API.

### Poll REST endpoints

Polling adds latency and load, cannot reliably observe transient states, and violates the product's live single-stream architecture.

### Webhooks, plugins, MCP or CLI hooks

HAPI v0.30.7 has no official durable notification hook with the required lifecycle events, namespace isolation and replay semantics. These mechanisms cannot currently replace the source adapter.

## Revisit condition

If HAPI accepts a minimal upstream event interface with stable completion/input/task semantics, namespace-scoped read-only credentials and durable cursors, replace inference in `OfficialHapiSource` with that interface. The Sidecar remains useful as the external durable broker and mobile delivery service.
