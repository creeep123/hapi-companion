# V0.6 Official-HAPI Sidecar

**Status:** design candidate  
**Owner:** HAPI Companion  
**Official HAPI baseline used for design:** `tiann/hapi@0239edf38e2da653d662f31039e24ccea04c7837` (v0.30.7)  
**Production impact of this work:** none until a separately authorized migration

## 1. Outcome

HAPI Companion must be able to use an unmodified official HAPI package. A Companion-owned Sidecar on the same VM observes HAPI's public REST and SSE interfaces, converts their state changes into the existing Companion event contract, stores every observed notification durably, and delivers it independently to the Mac app and the Android ntfy channel.

Normal delivery remains live rather than timer based. Once the Sidecar has observed and committed an event, each downstream consumer receives explicit replay and advances its own cursor. A HAPI restart can erase official HAPI's short in-memory event history; a transient event that both starts and disappears inside that outage can therefore be missed. The product owner explicitly accepts that exceptional loss boundary.

This version does not remove the current HAPI patch from production. It creates, tests, shadows and prepares the replacement. Patch retirement is a later, separately authorized production operation.

## 2. Product invariants

1. One long-lived official HAPI SSE connection per namespace; no event polling.
2. Native Mac banners, app-owned sounds, reminder policy and quiet hours behave as before.
3. Android delivery continues through ntfy and opens the exact HAPI PWA session.
4. Mac failure cannot block phone delivery; ntfy failure cannot block Mac delivery or upstream collection.
5. The Sidecar persists an observed canonical event before exposing or sending it.
6. Mac consumers explicitly ACK; disconnect before ACK causes replay.
7. A consumer starts at the current high-water mark and does not receive historical notification bursts.
8. Public HAPI origin and Sidecar API origin are distinct configuration values. All session URLs are rebuilt from the trusted public HAPI origin.
9. The HAPI access token remains on the VM. Mac and phone paths receive only scoped Sidecar credentials.
10. Namespace boundaries are established by the HAPI credential used to log in, never inferred from untrusted event JSON.

## 3. Accepted limits

- Official HAPI keeps SSE replay only in process memory, currently bounded to 256 events or 2 MiB. Its process epoch changes on restart. If a transient notification is born and disappears while that history is unavailable, the Sidecar may miss it.
- A known pending input/permission request can be recovered from a session snapshot. A completed session cannot always be distinguished from an abort after a gap, so the Sidecar prefers a missed completion to a false completion.
- Notification semantics rely on official event and session shapes that are public application APIs but not yet a dedicated stable notification contract. Every HAPI upgrade must pass the black-box compatibility gate in section 15.
- The official API has no notification-only credential. The Sidecar therefore needs a namespace-scoped HAPI CLI access token on the VM.

## 4. Official HAPI extension surface

The Sidecar uses only these official v0.30.7 routes:

| Purpose | Route | Required behavior |
|---|---|---|
| Login | `POST /api/auth` | Exchange a CLI access token for a four-hour JWT |
| Catalog | `GET /api/sessions` | Namespace-filtered session summaries |
| Detail | `GET /api/sessions/:id` | Full `agentState.requests` and turn state |
| Messages | `GET /api/sessions/:id/messages` | Cursor/page recovery for ready/task messages |
| Events | `GET /api/events?all=true&visibility=hidden` | One SSE, connected first frame, replay or gap indication |

The SSE connection sends `Authorization: Bearer <JWT>`. `Last-Event-ID` resumes within the same HAPI process epoch. The first frame must be `connection-changed` with `status=connected` and `resume=ok|gap`. The adapter ignores unknown event types and unknown fields while rejecting malformed required fields.

The Sidecar never imports private HAPI source modules at runtime, reads HAPI's database, scrapes logs, uses MCP hooks, or proxies internal browser traffic.

## 5. Architecture

```text
namespace-scoped HAPI token (VM credential file)
        |
        v
OfficialHapiSource -- one official REST/SSE adapter
        |
        v
EventInterpreter -- session snapshot + semantic inference
        |
        v  (single transaction: dedupe + event + deliveries + source cursor)
DurableEventStore
        |                              |
        v                              v
MacConsumerBroker                 NtfyDeliveryWorker
SSE + explicit ACK               independent retry/terminal state
        |                              |
        v                              v
HAPI Companion.app                 ntfy / Android
```

The implementation extends the existing Mobile Relay deployment and management plane, but its runtime is renamed conceptually to Companion Sidecar. Existing pairing, policy validation, ntfy posting and operational hardening are reused. The current serial `RelayEngine` is not extended with more branches; it is replaced by isolated source, interpreter, store and consumer modules.

### 5.1 `OfficialHapiSource`

This is the only module that understands official HAPI wire formats. It owns:

- access-token login and in-memory JWT renewal;
- the single upstream SSE connection;
- catalog, session-detail and message REST calls;
- SSE parsing, heartbeat timeout, reconnect backoff and `resume=ok|gap` handling;
- one isolated state machine per configured namespace.

State machine:

```text
STOPPED -> AUTHENTICATING -> CONNECTING -> SYNCING -> LIVE
              ^                 |             |
              +---- BACKOFF <---+-------------+
```

JWT refresh occurs before expiry and once immediately after an HTTP 401. Concurrent callers share one refresh operation. Repeated authentication failure is fail closed and visible through health status.

### 5.2 `EventInterpreter`

The interpreter consumes typed observations and owns session aggregate state:

- `active`, `thinking`, `activeTurnStartedAt`;
- title, agent/machine metadata and bounded last assistant text;
- pending request IDs and tools;
- per-session message cursor;
- ready cooldown and task/completion suppression window.

It emits a version 1 `CompanionEvent` candidate only when a supported semantic transition is proven. It does not perform network delivery.

### 5.3 `DurableEventStore`

The Sidecar uses its own SQLite database in WAL mode. This database is a Companion store; it does not read or tail HAPI's database. A single transaction commits:

1. the interpreted source dedupe key;
2. the canonical notification and sequence;
3. delivery rows for enabled consumers;
4. updated session/message snapshot;
5. the upstream SSE cursor.

Advancing the cursor without the corresponding canonical event is forbidden. This preserves all events already observed by the Sidecar even if the process crashes immediately afterwards.

The database stores bounded notification title/body needed for offline Mac replay. It never stores raw SSE frames, complete transcripts, CLI tokens, JWTs, ntfy topics or downstream bearer tokens. Files and backups must be owned by the service user and mode `0600`; the containing directory must be `0700`.

The initial implementation uses Bun's built-in `bun:sqlite`, which is present in the Relay's pinned Bun toolchain and supported by its compiled single-file executable. It does not add a database daemon or network listener.

### 5.4 `MacConsumerBroker`

Each Mac installation has a distinct consumer ID, credential hash and ACK cursor. The data plane retains the current contract shape:

- `GET /companion/sessions`
- `GET /companion/events`
- `POST /companion/ack`

The events response begins with the existing connected frame, then replays that consumer's unacknowledged rows and continues live. ACK requires the exact next sequence and event ID; mismatches return `409`. The token is valid only for these data-plane operations and its own revoke operation.

The catalog comes from the latest official HAPI snapshot, not from notification history.

Normative compatibility contract:

| Request/response | Required wire shape |
|---|---|
| Authentication | `Authorization: Bearer <consumer token>` and `X-Hapi-Device-Id: <consumer UUID>`; missing, mismatched, disabled or expired values return `401` |
| `GET /companion/sessions` | `200 application/json`; `{version:1, capabilities:{turnDuration:true}, sessions:[...]}` using the current `CompanionCatalog` field names; namespace comes from the consumer binding |
| `GET /companion/events` | `200 text/event-stream`; first frame exactly `event: connected` plus `data: {}`; heartbeat frames use `event: heartbeat`; notification frames use `id: <positive decimal canonical seq>`, `event: notification`, and one JSON version-1 `CompanionEvent` in `data` |
| `POST /companion/ack` | JSON `{seq:<integer>,eventId:<UUID>}`; `200` on exact next pending pair; idempotent repeat of the already ACKed pair is `200`; skipped/mismatched pairs return `409` |
| `GET /companion/status` | Same consumer authentication; `{version:1,replayExpired:<boolean>,replayAvailableFromSeq:<integer>,highWaterSeq:<integer>}` with no management data or secrets |
| Stream ordering | A consumer sees increasing canonical sequences. Gaps caused by events not targeted to it are allowed; ACK means the exact next delivery row, not `previous+1` globally |
| Payload limits | One event is at most 128 KiB encoded; title/session name and body retain current bounded limits; malformed stored data fails closed |

The unchanged current Mac client must pass this contract before its v2 binding code is enabled. Heartbeats never carry a sequence and never require ACK.

### 5.5 `NtfyDeliveryWorker`

The ntfy channel is a first-class consumer with its own delivery rows and retry state. The worker evaluates the existing session/keyword, duration and quiet-hours policy, then marks each row as:

- `accepted` after a valid ntfy provider response;
- `suppressed` when a configured rule intentionally suppresses it;
- `pending` for retryable failures;
- `failed` for operator-visible permanent configuration failures.

A stuck ntfy row never blocks source collection or the Mac broker. Provider acceptance followed by a crash may produce a duplicate phone notification because ntfy has no transactional idempotency handshake; this is preferable to silent loss.

## 6. Canonical event inference

The Sidecar emits the current version 1 contract and adds the already-supported product kind `input-request` to the TypeScript model.

### 6.1 Ready

Primary proof is a `message-received` envelope whose event data type is `ready`, while the cached session remains active. Use a five-second per-session cooldown. Fetch the latest bounded assistant message for preview text when needed; fall back to fixed safe copy. A `thinking: true -> false` edge alone does not create a normal live ready event because it can duplicate the explicit message.

### 6.2 Session completed

Emit only for `session-ended` with `reason=completed`. Other reasons are ignored. If a structured completed task notification for that session was emitted in the previous ten seconds, suppress the generic completion.

### 6.3 Task notification

Recognize both official forms used by v0.30.7:

- system output with subtype `task_notification`;
- user output beginning with a structured `<task-notification>` payload.

Normalize completion status and bounded summary. Malformed structured content is ignored rather than exposed verbatim.

### 6.4 Input and permission request

After a session-added or session-updated observation, fetch full session detail when the summary indicates request changes. Compare the new request-ID set with the stored set, debounce for 500 ms, and notify only new IDs.

After removing an optional `functions.` prefix, these tools are input requests: `request_user_input`, `AskUserQuestion`, `ask_user_question`, and `CursorAskQuestion`. Other tools are permission requests. The full request object is authoritative; catalog request-kind summaries are insufficient.

### 6.5 Duration

Record a turn start only from `thinking=true` plus a valid `activeTurnStartedAt`. Freeze duration when thinking becomes false. Ready/completion events use the frozen duration. When the Sidecar starts in the middle of a turn and cannot prove the start, `durationMs` is omitted; current Mac and mobile policy intentionally allow an unknown duration rather than suppressing a potentially important event.

### 6.6 Identity, deduplication and URL

A canonical `eventId` is deterministically derived from namespace identity hash, session ID, stable source identity (official event ID, message cursor, request ID or transition generation), and semantic kind. The original official event ID is retained only as non-secret diagnostic metadata.

Normative source dedupe keys are:

| Kind | Source key |
|---|---|
| ready/task recovered from message | `namespaceHash/sessionId/messageEpoch/messageAt/messageSeq/kind` |
| live ready/task without message cursor | `namespaceHash/hapiProcessEpoch/officialEventId/kind` |
| input/permission | `namespaceHash/sessionId/requestId/kind` |
| explicit completion | `namespaceHash/hapiProcessEpoch/officialEventId/session-completed` |
| reconciled ready | `namespaceHash/sessionId/priorTurnStartedAt/newSnapshotGeneration/ready-reconcile` |

`hapiProcessEpoch` is the epoch encoded by official SSE IDs and persisted with the source cursor. `snapshotGeneration` is a monotonically increasing Sidecar integer committed after each successful gap reconciliation. Message position is the official tuple `(epoch, at, seq)`, never a synthetic scalar. An official ready/task message cancels a provisional reconcile candidate for the same session and prior turn before either is committed. After a message epoch reset, the adapter establishes a new watermark from `snapshotHead`; it never re-emits older latest messages. Source dedupe rows outlive notification retention for 45 days so a late replay cannot recreate an expired notification.

The URL is always:

```text
<configured public HAPI HTTPS origin>/sessions/<percent-encoded session ID>
```

Absolute URLs supplied by an event are never trusted. The session must exist in the current namespace catalog.

## 7. Reconnect and gap behavior

### 7.1 Resume OK

When HAPI reports `resume=ok`, consume replay and live frames in their official order. Persist the official cursor only in the same transaction as interpretation state and any resulting canonical event.

### 7.2 Resume gap

REST snapshots are not globally atomic. To avoid losing or duplicating events during reconciliation:

1. Open SSE first and buffer frames after its connected handshake.
2. Fetch the session catalog and required full-session details.
3. Compare the new snapshot with the stored generation and create provisional recovery candidates.
4. Fetch messages after known per-session cursors where possible.
5. Apply buffered SSE frames in order. Explicit ready/task/end events or matching request IDs cancel weaker provisional candidates.
6. Commit remaining recovery candidates and the new snapshot, then enter live mode.

The reconciliation buffer is capped at 2,048 frames and 8 MiB encoded, whichever is reached first. Overflow aborts the uncommitted snapshot/candidates, closes the stream, records `source_reconcile_overflow`, and reconnects from the last committed SSE cursor after backoff. The source remains non-live and creates no deliveries until a complete reconciliation succeeds. Detail/message fetch concurrency is capped at eight and each request has a 15-second deadline.

Safe recovery behavior:

- newly visible request IDs may generate input/permission notifications;
- a prior known running turn that is now idle may generate a low-confidence ready only when no explicit ready was recovered;
- active-to-inactive without an end reason does not generate completion;
- cold start establishes a baseline and does not notify historical idle sessions or old requests.

An event that appears and disappears entirely while HAPI replay is unavailable remains unrecoverable and is an accepted limit.

## 8. Storage model

Minimum schema:

| Table | Purpose |
|---|---|
| `schema_meta` | Sidecar schema version and migration state |
| `source_binding` | HAPI origin, namespace hash, last event ID, snapshot generation and health code |
| `session_snapshots` | Bounded aggregate and message watermarks per session |
| `source_dedup` | Stable interpreted source keys |
| `canonical_notifications` | Monotonic sequence, version 1 event payload and retention metadata |
| `consumers` | Mac/ntfy identity, credential hash, enabled state and ACK cursor |
| `deliveries` | Per-notification, per-consumer pending/terminal state and attempts |
| `mobile_config` | Existing policy/config revision without secret topic material |
| `management` | Hashed management/bootstrap credentials and rate-limit state |

Retention has two bounds:

- terminal deliveries and their notification payloads are retained for a seven-day diagnostic grace;
- every notification and delivery has a hard 35-day expiry, including unacknowledged Mac rows.

An enabled consumer lease expires after 45 days without an authenticated catalog, stream, status or ACK request. Expiring a consumer disables future targeting; its existing rows remain eligible only until the notification's hard expiry. On reconnect after replay expiry, the broker returns the unchanged connected frame, advances that consumer to the current high-water mark, exposes `replayExpired=true` through `GET /companion/status`, and begins with new events. It never pretends the expired range was ACKed. A successful explicit re-pair or user acknowledgement of the warning clears the flag; merely opening the stream does not.

Database plus WAL has a 100 MiB operational ceiling. At 80 MiB the Sidecar checkpoints and runs retention GC. If hard-expired rows cannot reduce it below 90 MiB, the next source-event transaction is atomically refused, source ingestion enters `storage_limit`, immediately closes the official SSE, retains the last committed cursor, and stays non-live. It neither buffers nor discards later frames. During bounded backoff it reruns checkpoint/GC and reconnects only after measured database-plus-WAL size is below 80 MiB; resume then starts from the last committed cursor and follows normal `ok|gap` handling. A restart follows the same recovery gate before opening SSE. Tests cover an event crossing the threshold, crash while attention is set, successful GC recovery, and persistent exhaustion. A disabled or newly created consumer does not retroactively gain historical deliveries.

## 9. Credentials and trust boundaries

| Credential | Location | Scope |
|---|---|---|
| HAPI CLI access token | VM-only systemd credential or separate `0600` file | Namespace-wide official API access; never returned by Sidecar |
| HAPI JWT | Process memory only | Four-hour official API session |
| Sidecar management token | Hash in Sidecar store; clear value in Mac Keychain | Configuration and consumer lifecycle |
| Mac consumer token | Hash in Sidecar store; clear value in Mac Keychain | One consumer's catalog/events/ACK/revoke |
| ntfy topic | Separate VM secret material and Mac Keychain where currently required | Provider destination; redacted from status/logs |

No status, error, debug log, backup manifest or test fixture may include clear credentials or topics. Authentication errors are represented by stable codes.

## 10. Mac migration

The Mac client introduces a transport binding with two origins:

```text
publicHapiOrigin: URL
sidecarAPIOrigin: URL
consumerId: String
consumerToken: String
transportMode: patchedHub | sidecar
```

The version 2 Keychain item uses a new service name and remains scoped by normalized public HAPI origin. Existing reminder preferences, selected sessions, handled-event ledger, mobile settings and navigation continue to use the public HAPI origin, so changing the event endpoint cannot make settings disappear.

Migration procedure:

1. Preserve the legacy patched-Hub Keychain item.
2. Pair/register a Sidecar consumer and store the v2 item.
3. Probe authenticated catalog, connected frame and capability version.
4. Switch `transportMode` atomically only after the probe succeeds.
5. On failure, retain the old active binding and expose an actionable status.

The app never connects to patched and Sidecar streams simultaneously for user delivery. Their IDs are not equivalent, so dual delivery cannot be made safe by event-ID deduplication.

### 10.1 Bootstrap and recovery

Sidecar pairing uses the existing operator-visible, short-lived, one-time code model. The code is generated by a VM-local command or local privileged service action and contains no credential. The user enters the Sidecar HTTPS endpoint and code in the Mac settings UI; `POST /v1/pair` exchanges it for a management token after rate-limit and expiry checks. The app then calls `POST /v2/consumers` with a locally generated installation UUID, display name, normalized public HAPI origin and requested namespace binding. The response returns `{consumerId, token, publicHapiOrigin, sidecarAPIOrigin, contractVersion:1}` exactly once.

An existing Mac that already holds the Mobile Relay management token can create its Mac consumer without a new code. A fresh Mac, a Mac without mobile pairing, or recovery after loss/revocation needs a new one-time code. Revocation uses the management API or the consumer's self-revoke endpoint. Losing only the consumer token does not reveal or rotate the HAPI source credential.

The Sidecar accepts a consumer registration only when its requested public HAPI origin and namespace match the VM-local source binding. This prevents a paired manager from redirecting session links or crossing namespaces.

## 11. Management API evolution

Existing `/health`, `/v1/pair`, `/v1/status`, `/v1/config`, `/v1/test`, activation, repair, pause, resume and removal semantics remain compatible for the mobile UI. Add management-authenticated operations to create, inspect and revoke Mac consumers. Issued bearer values are returned once.

Compatibility is versioned rather than interpreting old device credentials as source credentials:

- state schema v1 remains readable for rollback;
- the first v2 start atomically imports management/bootstrap hashes, mobile configuration, policy revision, activation status and handled ledger into SQLite, while moving the existing ntfy topic and old patched-Hub device credential into a separate `legacy-secrets.json` rollback file with mode `0600`;
- the old `{deviceId,token}` is never used to authenticate official HAPI and is never returned by an API;
- `/v1/activate` and `/v1/repair` remain available only while `sourceMode=patchedHub`; in `sourceMode=officialHapi` they return `409 {error:"client_upgrade_required",requiredAPI:2}`;
- the updated Mac/mobile controller uses `PUT /v2/config` for policy/content settings and `POST /v2/receivers/ntfy` to activate the internal ntfy consumer. Those requests never contain a HAPI credential;
- the official HAPI access token is installed and rotated only by a VM-local command writing the configured systemd credential/`0600` source-secret file. Public management HTTP endpoints cannot set, read or rotate it;
- source binding activation probes `/api/auth`, catalog and the SSE connected frame before committing `sourceMode=officialHapi`; failure leaves the prior mode active.

V2 ntfy activation maps the existing receiver installation ID, topic secret, policy and content mode to one internal consumer. It returns a stable receiver ID and config revision, not a HAPI device token. The Mac UI preserves its existing paired state after the one-time v1-to-v2 migration.

`/v1/status` exposes only non-secret health and capability data, including:

- Sidecar contract version;
- source state and last observation time;
- outbox high-water sequence and bounded pending counts;
- consumer health without token/topic fields;
- content modes `fixed,eventPreview`.

## 12. Migration from patched production

### Phase A: local and integration validation

Run the complete test matrix against a clean official HAPI v0.30.7 checkout. No production change.

### Phase B: production shadow

After separate deployment authorization, run the Sidecar source/interpreter with delivery disabled. Compare hashed semantic observations with the current patched stream for real ready, completion, task, permission and input flows. Never enable a second ntfy dispatcher.

### Phase C: cutover

Use a short window with no active turns:

1. Drain and record non-sensitive old consumer cursors.
2. Stop the old mobile dispatcher.
3. Establish a new Sidecar snapshot baseline without historical delivery.
4. Set `cutoverAt` and activate only canonical rows created after it.
5. Switch Mac binding after its authenticated probe.
6. Confirm a real Mac banner/sound/click and a real Android notification/click.

Exactly one source may deliver to each consumer during cutover.

### Phase D: patch retirement

Only after an observation period and explicit authorization may Safe Updater remove the Companion patch pin and accept official packages directly. The Sidecar compatibility gate becomes a required HAPI-upgrade gate. Companion retains the final patched binary/database snapshot until the rollback window closes.

## 13. Rollback

Before an authorized Sidecar deployment or schema migration, retain:

- prior Sidecar binary/package and service unit;
- consistent Sidecar state/SQLite snapshot and checksum;
- old Relay JSON state;
- current patched HAPI binary/package and its required database snapshot;
- prior Mac transport binding in Keychain.

For a live WAL database, backup must use SQLite's online backup API into a new file followed by `PRAGMA integrity_check`, file sync, mode/owner verification and SHA-256 recording. The alternative is a stopped service followed by `PRAGMA wal_checkpoint(TRUNCATE)` and a copy of the database after confirming no `-wal`/`-shm` writer remains. Copying only a live main database file is forbidden. Secret files are copied separately with `0600`, excluded from ordinary diagnostics, and checksummed without printing their content.

Every schema release must test restore into the prior binary. If the prior binary cannot read the new schema, rollback restores its pre-migration database plus matching secret files; an in-place downgrade is forbidden. Restore acceptance runs integrity check, schema version check, non-secret row counts, consumer cursor checks and a disabled-delivery startup before traffic is enabled.

Rollback order is: stop new delivery, drain already-observed Sidecar events when safe, disable its consumers, restore the previous Relay/patch path, then switch the Mac binding. Restoring a HAPI binary across schema boundaries requires its matching database snapshot. Do not re-enable both ntfy dispatchers.

## 14. Resource budget

Expected per namespace on the current VM:

| Resource | Budget |
|---|---|
| Executable/package | 90–110 MB uncompressed |
| Database + WAL + bounded journal | normally 10–50 MB; operational allowance 100 MB |
| RSS | 40–100 MB |
| Idle CPU | below 0.2% target |
| Average CPU | below 1% at ordinary notification volume |
| Connections | one HAPI SSE plus one Sidecar SSE per online Mac |
| Network | generally megabytes per day, workload dependent |

Release acceptance records measured idle/load values and verifies journal bounds rather than relying solely on these estimates.

## 15. Verification and compatibility gates

### 15.1 Official source

- auth success, bad credential failure and in-memory JWT refresh;
- namespace A/B catalog and event isolation;
- exactly one upstream SSE and no polling loop;
- connected first frame, heartbeat, `resume=ok`, replay order and `resume=gap`;
- SSE CRLF, multi-data lines, partial frames, size limits and unknown event compatibility;
- catalog/detail/message pagination and message epoch reset;
- capability failure is fail closed and visible.

### 15.2 Interpretation

- all five kinds: ready, permission-request, input-request, task-notification and session-completed;
- request-tool classification and request-ID debounce;
- ready cooldown, task/completion suppression and end-reason filtering;
- known/unknown duration behavior;
- deterministic identity, bounded sanitized content and exact encoded URL;
- gap snapshot/live race produces neither duplicate nor provable loss.

### 15.3 Durability and consumers

- crash before/inside/after canonical transaction;
- crash before Mac ACK causes replay; correct ACK advances; wrong sequence/ID returns `409`;
- ntfy accepted-before-crash behavior documented and bounded;
- Mac offline does not block ntfy/source;
- ntfy retry/permanent failure does not block Mac/source;
- independent consumers and new-consumer high-water behavior;
- retention and WAL size bounds.
- consumer status reports replay expiry without changing the legacy connected frame;
- storage-limit threshold atomically refuses the event, closes SSE, preserves the cursor and resumes only after recovery.

### 15.4 Security

- credential and topic redaction from API responses, logs and diagnostics;
- file ownership/modes and symlink/path escape refusal;
- scoped consumer authorization and self-revoke;
- pair code expiry, one-time use and rate limits;
- malicious origin, session ID and cross-namespace access rejection;
- backup/restore permissions.

### 15.5 Migration and clients

- Relay v1 JSON to Sidecar schema migration preserves mobile policy/revision without leaking secrets;
- Mac legacy Keychain binding remains usable; v2 probe and atomic switch work; rollback restores it;
- origin-scoped settings, selection, ledger and mobile configuration remain visible;
- real unmodified HAPI v0.30.7 triggers each notification kind;
- real Mac banner, sound and exact PWA reuse/navigation;
- real OPPO notification and exact-session click with VPN on and off;
- Hub restart demonstrates the documented accepted gap boundary.

### 15.6 HAPI upgrade gate

Every candidate official HAPI version must run a black-box suite covering auth, namespace isolation, catalog/detail/messages schemas, connected/resume behavior, replay/gap, the five semantic fixtures and exact URL construction. HAPI can upgrade without a Sidecar release when this gate passes. A failure blocks that HAPI upgrade until the adapter is updated and reviewed.

## 16. Acceptance criteria

- A clean official HAPI v0.30.7 package works without `integrations/hapi/hapi-companion.patch`.
- An observed event survives Sidecar restart and replays independently to an unacknowledged Mac consumer.
- Mac and Android delivery pass independently when the other path is offline or failing.
- Existing user rules, sounds, quiet hours, mobile content mode and exact-session navigation behave unchanged.
- No HAPI access credential appears outside the VM trust boundary or in observable output.
- Technical, security and client migration reviews have no unresolved blocking findings.
- Deployment and patch retirement remain gated by explicit authorization and real-device acceptance.
