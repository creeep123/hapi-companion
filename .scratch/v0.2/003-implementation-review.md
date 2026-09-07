---
title: V0.2 independent implementation review — first pass
status: ready-for-human
owner: engineering-review
version: V0.2
specs:
  - docs/specs/V0_2_NOTIFICATION_SETTINGS.md
---

# Verdict

Changes requested for two P2 items. No confirmed P1 finding in the reviewed client/policy/catalog/duration implementation. This pass inspected in-progress source on 2026-09-08; parent and other agents were still compiling, adding service tests and finalizing the Hub patch. It does not establish final build or runtime acceptance.

Scope: all current Sources Swift files, ReminderPreferences/Policy/Delivery tests and existing baseline test inventory; .build/hapi-v02 notificationHub, turnDurationTracker, eventParsing and companion catalog route. Reviewed against V0.2 specification and 002-plan-review. No implementation edits or production mutations performed.

## Findings

### P2-1 — upgrade loses handled-event ledger

CompanionModel v0.1 uses global `deliveredCompanionEventIds`; V0.2 reads only `handledCompanionEvents.v2.<origin>`. A notification delivered just before upgrade whose ACK failed can replay and sound again, even though the old app already remembered it. This violates upgrade deduplication at the existing delivery/ACK boundary.

Required fix: one-time migration of the old ledger to a safely attributed current origin, preferably using the preexisting device credential's Hub origin as evidence; retain bounded dedupe and avoid repeatedly importing into unrelated origins. Add a test seeding the old ledger and simulating ACK-pending replay after upgrade, plus a different-origin isolation check. Parent accepted this finding during review.

### P2-2 — right-click test action absent

AppDelegate.statusClicked currently builds only settings and quit menu actions; V0.2 Client architecture explicitly specifies settings/test/quit. The settings window has the test action, but the agreed menu contract is not implemented.

Required fix: add right-click test action wired to the same permission-respecting manual test path, or explicitly resolve the specification before claiming complete. Do not introduce a second notification implementation. Parent notified.

## Contract clarification, not a code defect

An initial concern that notifyTask lacked duration was investigated and withdrawn. eventParsing.extractTaskNotification reads Claude background child-task output (`task_notification` / `<task-notification>`), not the foreground ready event enriched with AGENT_NOTIFY_SUMMARY. Assigning foreground duration to it would be incorrect. Unknown duration should remain absent and fail open. Clarify the spec's ambiguous “structured completion” wording and preserve a test that child completion does not freeze foreground timing.

## Checks that look correct by source inspection

- ensureCredential now shares an in-flight task across actor reentrant catalog and SSE requests. Catalog HTTP failures do not directly delete scoped credentials or cancel the stream.
- One SSE runTask is guarded during normal start; catalog is settings-open/manual only, with model-level in-flight refresh coalescing and no timer.
- Catalog route authenticates device headers, obtains namespace only from authenticated device, defensively filters namespace, and emits a narrow ID/title/host/updatedAt/active projection.
- Duration tracker recognizes a changed start while thinking remains true, freezes completed duration, and ready/generic completion obtain duration context before first channel await.
- Event decoder treats malformed/negative/unrepresentable optional duration as unknown without blocking durable replay.
- Pure policy implements actual stable session IDs OR literal case-insensitive title keywords, strict threshold, permission-request bypass, local quiet endpoints/midnight and event-time plus delivery-time quiet evaluation.
- Default preferences preserve old notifications; per-origin keys normalize scheme/host/default ports and exclude URL secrets.
- Suppression runs before OS banner checks, is remembered then ACKed; banner-only never plays sound; failed required effects do not ACK. Dedupe precedes effects after changed rules.
- App startup remains independent of notification permission, and app-hosted tests/preview bypass production pairing/login registration.
- Status item and one settings NSWindow are retained, reopen focuses same window, closing is nonterminating; actual visual/runtime behavior still needs evidence.
- Session list contains real catalog rows at runtime; demo rows are preview-only. Missing selected IDs remain removable and error state preserves existing rows.

## Acceptance evidence still needed

1. Shared-credential service tests covering simultaneous acquisition, real request headers/paths and legacy catalog error isolation. Pure-policy tests alone cannot verify network orchestration.
2. Final clean-baseline patch apply, patched Hub full tests/build, Swift suite and universal release build after fixes. Parent owns execution evidence.
3. Native runtime/UI evidence: visible brand/fallback status icon, click/reopen singleton window, close/background behavior, autosave and notification navigation/sound. Screenshots alone prove appearance, not these interactions.
4. Final independent re-review of addressed findings and generated patch/release docs. Local implementation must not be reported as production installed or deployed.


# Final source re-review — 2026-09-08

Verdict: APPROVE SOURCE CHANGES; both P2 findings resolved. Native user acceptance and final build evidence are separate gates, not implied by this source verdict. No remaining confirmed P1/P2 issue found in this review scope.

- P2-1 resolved in CompanionHandledEvents: on authenticated replay only, an exact previously handled UUID is imported into the canonical origin ledger. This avoids guessing an origin for the whole legacy list. The old finite UUID ledger remains a compatibility lookup; new events are recorded only per origin. CompanionModel consults this ledger before effects and remembers successful/intentional handling through the same ledger. CompanionHandledEventsTests verifies exact-match-only migration, canonical origin equivalence, survival after legacy removal and isolation of the new scoped entry.
- P2-2 resolved: right-click menu offers “测试提醒（会播放声音）” and invokes CompanionModel.sendTestNotification, sharing its permission checks and explicit manual bypass semantics.
- Spec now distinguishes foreground ready completion with structured summary from independent background child completion. The cumulative Hub patch retains absent duration for the latter.
- Service injected-transport tests now cover concurrent ensureCredential + catalog pairing once, scoped request credentials, no implicit catalog requests during credential lookup, and unsupported/unauthorized catalog requests leaving credential storage untouched. This establishes the tested shared acquisition path; it does not simulate a full live streaming socket.
- Window tests establish test-host launch does not create a production model, and the same retained NSWindow survives close/recreation requests. They do not prove the physical menu bar icon is visible or a real click opens the window.
- Reinspected cumulative Hub patch and isolated source: authenticated namespace-limited catalog; finite optional duration projection; ready duration captured before suspended channel fan-out; generic completion retains duration after inactive-state start clearing; child duration intentionally absent. Added tracker and NotificationHub tests cover repeated turn IDs, frozen context, clear/restart unknowns and durable replay payload.

This re-review did not modify implementation files. Parent must retain authoritative final test/build outputs and native preview evidence in the version acceptance record, and must not describe repository implementation as installed production functionality before explicit deployment/acceptance.

# Final acceptance audit — ready for human acceptance

Independent evidence inspected after final UI command adjustment:

- `/tmp/hapi-companion-v02-swift-final-tests.log`: 29 tests, 0 failures; TEST SUCCEEDED.
- `/tmp/hapi-companion-v02-universal-build.log`: BUILD SUCCEEDED. Independent `lipo -archs` on the release executable returned `x86_64 arm64`.
- Hub package logs and `004-hub-validation.md`: compatible-node Web 2,796 pass; Hub 1,216 pass / 3 skipped; Shared 283 pass; Relay 80 pass; documented CLI count completes aggregate 6,787 pass / 4 skipped. Original Web environment failure and clean-baseline reproduction both inspected; successful rerun is explicitly separated, not concealed.
- Cumulative patch SHA-256 independently recomputed and matches `2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd`.
- `docs/design/v0.2-settings-implemented.jpg` visually inspected: compact native single window, actual-session-shaped list with explicit preview label, search/selection/keywords, threshold, quiet hours, test action and autosave present without clipping of the main controls.
- HapiCompanionApp now replaces the standard settings command with the same retained settings window action; it does not add a second visible settings implementation.
- `docs/management/V0_2_ACCEPTANCE.md` correctly separates automated source/build evidence, preview interaction evidence and production/human gates. Physical menu-bar icon, login/reopen behavior on installed app, production session catalog and human sound/banner/deep-link acceptance remain explicit.

Final verdict: READY FOR HUMAN ACCEPTANCE / APPROVED FOR FEATURE REVIEW. This is not a production deployment approval or claim of completed real-session sensory acceptance. Parent should finalize the actual feature PR reference and update provisional build wording to the verified universal result. No remaining confirmed code defect requires another implementation cycle before that gate.
