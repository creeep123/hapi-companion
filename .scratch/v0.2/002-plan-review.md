---
title: V0.2 independent technical plan review
status: ready-for-agent
owner: engineering-review
version: V0.2
specs:
  - docs/specs/V0_2_NOTIFICATION_SETTINGS.md
---

# Verdict

Conditional pass: the proposed one-window implementation fits the approved design and preserves the one-SSE/outbox/explicit-ACK architecture. Resolve the two contract gaps below before their respective implementations. No additional product scope is requested. This is a plan review, not evidence that implementation or runtime acceptance passed.

Reviewed on 2026-09-08: V0.2 spec, Control Panel, implementation issue, existing Swift delivery/service/model/delegate, repository Hub patch, and reference NotificationHub plus clean-baseline sessionCache via git show d3d4fd17. No production process, reference source, authentication configuration, or implementation file was changed.

## Required clarifications

### P1 — concurrent catalog/SSE credential acquisition

Existing CompanionService.ensureCredential suspends across authentication/registration network requests. Actor isolation does not prevent a second caller entering during those awaits. Adding settings-open catalog fetching can therefore register the same installation twice, rotating its token while the SSE caller is opening its connection. Catalog refresh coalescing alone does not coalesce pairing with SSE startup.

Fix: specify a shared in-flight credential-acquisition task or make catalog consume an already established service credential. Ensure both entrypoints use one pairing operation; a catalog failure must not delete/rotate credentials under a healthy stream. Do not create a separate credential store or alter auth routes/token format. Test concurrent initial catalog + stream acquisition and unauthorized/unsupported catalog isolation using a fake transport.

### P1 — precise turn boundary and async duration snapshot

The clean baseline sessionCache can change activeTurnStartedAt while thinking remains true (a queued next turn; around lines 384–385). Tracking only false→true would accumulate two turns. Session completion follows a state update clearing activeTurnStartedAt; generic completion currently lacks NotificationSendContext. Channel dispatch also awaits channels sequentially, allowing the session object to mutate before CompanionChannel runs.

Fix: define turn identity by valid activeTurnStartedAt changes, not only thinking transitions. Snapshot a nonnegative finite duration synchronously when ready/structured-completion/session-end is observed and pass the immutable value through all relevant send contexts, including generic session completion. Preserve a closed-turn snapshot across immediate ready/structured/session-end ordering, reset it when a new start is observed, and do not infer a start from the first observed heartbeat after restart. Tests must cover same-thinking/new-start, end-state clearing, a deliberately suspended earlier channel followed by a new turn, and repeated completion events retaining a stable duration. Existing strict `>` threshold and unknown-duration fail-open behavior are appropriate and should remain.

## Implementation acceptance notes (nonblocking)

- Rules must be evaluated before checking OS banner permission: intentionally suppressed events can still be remembered and ACKed when permission is disabled. Starting the stream only after permission grant, as the old model does, must not defeat intentional suppression or restoration after settings changes.
- Preference storage origin keys should use canonical scheme/host/effective port, consistently with credential origin checks. Exclude query, credentials and paths. Settings must not momentarily evaluate an event using another origin's default/preferences during async loading.
- Missing selected sessions must remain explicitly removable after successful catalog refresh. On a transient refresh error, preserve prior rows and selections rather than implying deletion. Keywords are literal title substring matches, not inferred task types.
- Keep policy evaluation/dedupe order explicit: already handled ID → ACK retry; otherwise policy → required delivery → remember → ACK. The UI should describe that filtered events are consumed and not replayed if a setting changes.
- Invalid optional duration must not become a permanently undecodable poison event. Validate Hub finite/nonnegative values; client should treat malformed/missing duration as unknown where safely decodable. Add malformed numeric/negative tests.
- Native runtime acceptance remains necessary for status-item visibility, first/reopen singleton window behavior, app-owned sound and OS notification click navigation. Unit tests cannot establish these visual/runtime outcomes.
- Quiet-hours equal endpoints meaning all-day, threshold equality being suppressed, and legacy unknown duration passing through are deliberate specified choices, not review defects.

## Review closure

Parent should record spec amendments resolving P1 items, then change status to reviewed/accepted. Final implementation review must independently inspect these behaviors and test coverage; this plan review does not waive A1–A9.

## Resolution by implementing owner

2026-09-08: Both P1 amendments incorporated into V0.2 spec: single-flight pairing and immutable duration snapshots keyed by turn start including thinking-stays-true transitions. Review accepted; implementation may proceed. Remaining notes are acceptance requirements.
