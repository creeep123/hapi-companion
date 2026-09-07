# V0.2 — Lightweight notification settings

Status: reviewed and accepted for implementation (2026-09-08); see .scratch/v0.2/002-plan-review.md.
Owner: creeep123. Integration branch: main. Work branch: feature/v0.2-notification-settings.
Baseline: e12f1dd / public v0.1.0. Target: 0.2.0 (unreleased).
Approved visual reference: ../design/v0.2-settings-approved.png.

## Outcome and scope

One native settings window, opened by clicking the menu-bar icon or reopening the app. Select actual HAPI conversations by ID or literal title keywords. Skip quick turns. Schedule local quiet hours. Changes autosave; closing the window keeps the one SSE stream running. No sidebar, categorization AI, periodic HTTP requests, replacement HAPI UI, or updater work.

User authorized the technical proposal, subagent expert review, implementation and iterative validation on 2026-09-08. Local preference persistence and repository Hub integration changes necessary for these features are part of that scope. Production deployment, credential-model changes and database migration changes remain excluded and require operator approval.

## Product rules

- Upgrade defaults preserve existing behavior: all sessions, duration filter off, quiet hours off. Example values when enabled: 1 minute and 23:00–08:00, mute sound only. These are initial values, not silently enabled policies.
- Scope picker: all sessions / specified sessions. Specified = selected session ID OR current completion-event title contains ANY nonempty keyword (trimmed, Unicode case-insensitive literal substring; no regex). New sessions can match keywords. Empty specified selection means no sessions qualify, with explicit UI explanation.
- Selection uses ID, survives title changes. List comes from actual Hub catalog, supports search, loading/error/empty states and manual refresh. Missing/deleted selected sessions remain removable. No fabricated/demo rows during normal runtime.
- Local rules belong to configured Hub origin, not globally to every Hub. No credential or message body persisted in preferences.
- Duration is current turn wall-clock elapsed time, not conversation age or delivery delay. Strictly greater than threshold qualifies. Threshold 1–1440 minutes. Missing/invalid duration is not guessed: pass through with visible compatibility explanation so legacy events do not silently disappear. Permission requests bypass duration filtering (they can block task completion); session scope and quiet hours still apply.
- Quiet hours use local calendar/time zone: inclusive start, exclusive end, support midnight crossing. Equal start/end explicitly means all day. Modes: mute sound (banner only), suppress all. Evaluate both event creation time and delivery time; if either is quiet apply quiet behavior. Thus events created during quiet hours do not burst on reconnect after quiet hours.
- Intentional suppressions are terminal handled events: remember event ID before explicit ACK. Transient banner or required sound failures are not handled and must not ACK. Mute mode requires banner success, not sound. Never play sound for suppressed events. Dedupe bypasses later rule edits so ACK failures cannot retroactively notify handled events.
- Manual test explicitly bypasses scope/duration/quiet rules and explains that behavior in UI; respects OS notification authorization. It never creates a Hub event or ACK.

## Client architecture

- AppDelegate owns a durable NSStatusItem and a single retained NSWindow/NSHostingView. Explicit 18pt template brand image with SF Symbol fallback, accessibility label HAPI Companion. Left click opens/focuses settings; right click menu exposes settings/test/quit. Reopen calls same window path. Closing never terminates app. No production service or login item registration in unit-test/preview modes.
- CompanionPreferences: Codable value, versioned per-origin UserDefaults storage; normalized bounds/keywords; observable main-actor settings store autosaves immediately. Separate pure policy evaluator produces notifyWithSound / bannerOnly / suppress(reason).
- CompanionModel orchestrates catalog, preferences, permission, connection and delivery. True connected state is published after HTTP 200, not left at connecting. Settings remain accessible when permission/network fail. The stream runs independently of notification authorization so intentional suppression can still ACK; real delivery checks current permission and defers on failure. Refresh permission on window activation.
- Credential acquisition is single-flight across catalog and SSE: a shared in-flight Task prevents actor reentrancy from registering twice and rotating tokens. Catalog errors cannot delete a newer credential; stream authentication recovery remains the only invalidation path.
- Service maintains exactly one completion SSE; add optional durationMs decoding. Catalog fetched on settings open/manual refresh, coalesced; no timer and no second SSE. GET /companion/sessions uses the existing device token and X-Hapi-Device-Id, returning {sessions:[{id,title,machineName?,updatedAt,active}], capabilities:{turnDuration:true}}. Namespace comes only from authenticated device, never caller input. Unsupported route = visible upgrade guidance; do not fall back to broad user credentials. Catalog failure cannot stop notification stream.
- Session URL validation and Edge navigation remain unchanged.

## Hub integration

- Extend reviewed integration patch against the same clean HAPI baseline. Optional durationMs in durable payload; no schema bump because payload is JSON.
- Add minimal namespace-isolated session catalog access using existing device authentication, without changing token format/privileges beyond reading ID, title and machine display metadata needed by this UI. Include compatibility capability so old Hubs produce actionable guidance.
- Capture activeTurnStartedAt from synchronous NotificationHub lifecycle events in an independent in-memory turn tracker before thinking=false/session-end clear it. Preserve the ended-turn snapshot for ready (including AGENT_NOTIFY_SUMMARY)/completion ordering; clear on a new turn, including a changed valid activeTurnStartedAt while thinking stays true. Capture an immutable duration context synchronously before the first channel await, including generic completion. Pass optional durationMs through NotificationSendContext to CompanionChannel and durable JSON. Never use changing thinkingAt, session createdAt or delivery time. Unknown start after restart remains absent, no invented duration. Wall time includes permission waiting.
- Catalog callback reads getSessionsByNamespace from SyncEngine and title via shared getSessionName. Restrict projection to the UI fields; no message bodies/paths/credentials/agent state. No cache/database schema change. Reference source d3d4fd17 exists in /Users/mayuming/develop/hapi-maintenance/source with unrelated local changes: create an isolated detached worktree and never modify that working tree.
- Child task-notification events have no independent duration evidence; their duration remains unknown rather than borrowing the foreground task duration. Ready notifications enriched with AGENT_NOTIFY_SUMMARY carry the foreground duration.
- Legacy processed UUIDs are migrated lazily only when the same authenticated Hub replays that exact UUID; never assign the whole originless legacy ledger to an arbitrary Hub.
- Baseline patch remains reproducible and tested in isolated worktree; no live Hub patching.

## Acceptance / verification matrix

- A1 entry: status icon retained/fallback; click and app reopen focus one settings window; close preserves background service. Native runtime evidence or explicit human gate if OS UI automation unavailable.
- A2 rules UI: approved single-window grouping, actual session search/selection, chips add/remove, defaults and empty/error/unsupported states, autosave/relaunch.
- A3 pure policy: all vs specified, ID stability, Unicode keyword OR, empty keyword, empty selection, threshold equality and unknowns, permission bypass, quiet same-day/overnight/all-day/timezone and delayed replay.
- A4 delivery: suppression acknowledged and deduped; banner-only never calls sound; required delivery failure prevents ACK; rule changes during ACK retry do not redeliver.
- A5 catalog: auth/namespace isolation, minimal fields, rename/deletion reconciliation, failure isolation and no HTTP polling; real catalog adapter integration tests.
- A6 duration: repeated turns, structured/generic completion, unknown start/restart, replay preserving duration and short-vs-long test cases.
- A7 backward compatibility: old event without duration parses, legacy Hub continues existing notifications and displays catalog/threshold limitation.
- A8 regression: doctor, all Swift tests, universal release build; full patched Hub test/build and patch apply check. Record environmental/upstream baseline failures separately with comparison evidence.
- A9 security/release: no secret output, no prod mutation, source diff review by independent subagent, version/release docs and clear manual acceptance/rollback instructions. Feature PR through canonical main review where available; no public tag or deployment without user instruction.

## Implementation order

1. Finalize technical contract after source reconnaissance; independent subagent review and resolve findings.
2. Parallel bounded implementation: preferences/policy + tests; Hub patch + tests; root UI/service integration.
3. Build and test; independent source/behavior review; resolve findings and repeat targeted checks.
4. Record evidence and hand over only unavoidable human runtime/deployment acceptance.
