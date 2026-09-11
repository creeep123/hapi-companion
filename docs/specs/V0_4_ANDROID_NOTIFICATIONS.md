# V0.4 — Android notifications with exact-session opening

Status: deployment candidate. Owner: creeep123. Canonical branch: `main`. Work branch: `feature/v0.4-mobile-notifications`.

## Product outcome

An Android user can subscribe one phone, receive only qualifying HAPI completion reminders while the Mac is asleep, and open the exact `/sessions/<id>` route with one tap. The first supported receiver is the official ntfy Android app on ColorOS; the transport stays provider-shaped so an iOS receiver or a self-hosted ntfy server can be added without changing completion-event semantics.

The user has already verified on an OPPO Find X9 Pro (PLG110, ColorOS 16.0.10) that the official ntfy F-Droid build receives a delayed notification and that ntfy's click action opens the installed HAPI Chrome PWA at the requested session.

## Release boundary

### In scope

- public `https://ntfy.sh` for the first release, with a configurable HTTPS base URL in the data model;
- one independently running mobile-delivery worker on the Hub VM;
- one durable Companion SSE connection and explicit ACK for that worker; no polling;
- exact HAPI event URL sent as ntfy's `Click` action;
- a fixed product title plus a fixed, non-sensitive completion summary; never the session title or agent response body;
- the existing session ID/title-keyword, turn-duration and quiet-hours policy semantics;
- a small “手机通知” section in the Mac settings window to enable delivery, create or rotate a random topic, show a scannable subscription QR code, send a real test, display worker health and remove the phone;
- one phone in V0.4; data structures may support stable receiver IDs but no multi-phone management UI;
- agent-readable VM install, upgrade, backup and rollback instructions.

### Out of scope

- building or forking an Android app;
- PushPlus, Server酱 or WxPusher integration;
- notification reply/actions, message transcripts, attachments or AI summaries;
- per-phone rule editors, cross-account administration or a general notification service;
- changing `hapi-safe-updater` implementation in this repository;
- silently deploying to production.

## User experience

The “声音与设置” tab is ordered `应用更新 → 系统设置 → 手机通知 → 提醒音效`. The phone card states “当前版本支持 1 台手机” and “本版已验证 ntfy Android；iPhone 尚未支持和验收”.

Relay installation/pairing and phone onboarding are separate stages. An installation Agent first installs the Relay, configures its TLS endpoint, obtains a one-time pairing code from the VM and pairs the Mac control surface. The normal phone flow starts only after the card says “Relay 已配对”. If the Agent cannot transfer the one-time code through an authorized local action, the user enters that one short-lived code; it is never requested in chat or retained.

1. “添加手机” creates a cryptographically random topic and a disabled mobile receiver configuration. A toggle appears only after setup succeeds. Secrets are never shown in logs or ordinary status text.
2. The app shows both a QR containing the documented `ntfy://ntfy.sh/<topic>` deep link and “复制订阅地址”. The user may scan with the system camera or paste the address into ntfy. QR recognition is a required real-device acceptance item because the earlier experiment used manual topic entry; the copy path must work independently.
3. “测试手机通知” sends a selected real catalog session ID through the VM worker, bypasses reminder rules and does not create a Hub event. Relay applies the same strict click reconstruction as production. Success means ntfy accepted the message; the UI asks the user to verify receipt and exact-session opening. It does not claim phone display delivery. The existing action is renamed “测试 Mac 提醒”.
4. The user confirms “我已收到并成功打开会话”. Only then does the Mac register a new, independent Relay device with the existing Hub registration API and submit activation through the idempotent saga; Relay atomically persists its own committed state before starting. Cancelled or unconfirmed setup creates no Hub device and leaves delivery disabled.
5. Mobile notifications use the rules for the currently configured Hub origin. The card says “手机使用与这台 Mac 相同的提醒规则” and separately reports the local revision, last successfully synchronized revision/time/time zone, or “同步失败，手机仍使用上次规则”. Sync runs after local rule changes, app/relay reconnection and system-time-zone changes. Because the authenticated status API deliberately does not return session/keyword policy, a 409 conflict offers “用这台 Mac 的规则覆盖” or “稍后处理”; neither overwrites silently or pretends to reload unavailable rules.
6. Quiet mode uses the existing labels. “只静音” requests ntfy priority 2; Android settings ultimately control sound, so the UI calls it a low-priority request until OPPO acceptance confirms its observed behavior. “关闭全部提醒” records the event as intentionally handled without posting.
7. Pausing phone notifications keeps the one SSE active. Each arriving event is durably handled as “手机通知已停用” and ACKed without an ntfy request, so paused events never burst after resume. The switch says “停用期间的提醒不会补发”. Removing the phone idempotently stops the Relay stream and clears destination/device credential, then Mac uses a fresh user JWT to disable the Hub device. Hub DELETE 404 is treated as already removed. The Relay management pairing remains, returning the card to “添加手机”; a separate explicit “断开 Relay” action or VM CLI revokes the management bearer. Failure shows “移除未完成” with “重试移除”. Rotating makes the Relay stop future posts to the old topic; it cannot revoke existing subscriptions or delete public-provider cache.

The settings UI reports independent facts instead of one “healthy” badge: phone delivery enabled/disabled, Relay reachable/unreachable, rules synchronized/pending/failed, latest ntfy acceptance time, Hub stream/last ACK, and cleanup required. It always says “ntfy 已接收不代表手机已显示”. It never displays a raw device token or topic in ordinary status text.

Before setup continues, show this concrete disclosure:

> 手机通知将通过公共服务 ntfy.sh 转发。该服务会收到固定的 HAPI 提示和对应会话链接，不会收到会话标题或 AI 回复正文。任何获得订阅地址的人都可能收到后续通知，请勿分享二维码或订阅地址。

## Architecture

```text
HAPI completion
    -> existing durable namespace outbox
    -> one device-scoped SSE for Mobile Relay
    -> shared pure reminder-policy evaluation
    -> HTTPS POST to configured ntfy server/topic
    -> HTTP 2xx: persist handled event, then explicit Hub ACK
    -> Android system notification
    -> Click: authoritative event URL
    -> Chrome/HAPI PWA /sessions/<id>
```

### Components

1. **Hub patch** retains ownership of facts and durable delivery. V0.4 reuses its existing JWT-authenticated device register/delete routes and device-scoped SSE/ACK routes unchanged. If implementation reconnaissance contradicts this, stop and return to architecture review before any patch edit or updater handoff.
2. **Mobile Relay** is a small headless executable in this repository, installed as a dedicated non-root service on the Hub VM. It holds its own device-scoped Hub credential, `0600` atomically written destination/state, policy snapshot, handled-event ledger and health state. It owns exactly one completion SSE. Backup encryption is an operator responsibility.
3. **Mac Companion** remains the control surface. It uses its existing authenticated relationship with the Hub to provision the relay device, sends configuration directly to the operator-selected relay endpoint over HTTPS, shows the QR and performs setup confirmation. It never forwards completion events, so Mac sleep does not stop mobile reminders.

### Provisioning and authentication

- The relay exposes a narrow HTTPS management API: public minimal `GET /health`; `POST /v1/pair`; and authenticated `GET /v1/status`, `PUT /v1/config`, `POST /v1/test`, `POST /v1/activate`, `POST /v1/pause`, `DELETE /v1/receiver`, `POST /v1/unpair`.
- `POST /v1/pair` consumes a VM-locally generated ≥128-bit random one-time code with a 10-minute TTL, single-use atomic consumption and per-source/global failure limits. It returns a new random management bearer once. Relay stores only its hash; Mac stores it in Keychain. CLI/logs may print the one-time code once but never any long-term credential. `GET /v1/status` can query a known activation without returning secrets.
- Activation is an idempotent saga across Hub and Relay. Mac first persists a stable random `activationId`, stable Relay `installationId` and operation state. It registers that installation once through the existing `/api/auth` and Hub route, then retains the first returned device ID/token in Keychain until Relay confirms commitment; it must not blindly re-register because the current Hub route rotates the token on an installation-ID conflict.
- `POST /v1/activate` carries `activationId`, Hub device ID/token and the full configuration revision. Relay atomically persists all fields before starting SSE. Repeating the same activation returns the committed result without changing credential/config; a different activation against an already bound Relay returns 409.
- Pair/status/activate share one persistent state-machine lock. Each activation retains a pending, committed or rejected record/tombstone. A missing or temporarily unknown status never proves rejection.
- Only an explicit terminal Relay rejection permits Mac to obtain a fresh user JWT and compensate with Hub DELETE. On timeout, unknown result or unreachable Relay, Mac retains the operation and retries the same activation without deleting. Unfinished compensation is “移除未完成”. A committed Relay with an invalid Hub credential pauses in attention state and requires explicit repair; it never silently registers again. Hub credential values may exist briefly in process memory but never appear in UI/logs or response-readable configuration.
- One Relay instance binds immutably to one HAPI HTTPS origin and one namespace-scoped device. Switching Hub or namespace requires removal and fresh pairing.
- The public service binds only behind the existing VM TLS reverse proxy. No plaintext public listener is supported.
- Topic values and relay credentials are redacted from logs, errors, support bundles and screenshots. The topic is generated with at least 128 bits of entropy and is stored in Mac Keychain if it must be shown again. Relay stores secrets in a dedicated non-root service user's `0600` state, writes atomically, and excludes plaintext secrets from ordinary backups; encrypted backup is an operator responsibility explicitly documented by the runbook.

### Configuration model

The relay stores a versioned record containing:

- receiver ID and enabled/setup-confirmed flags;
- ntfy HTTPS base URL and random topic;
- public HAPI origin used to validate event click URLs;
- normalized reminder policy: scope, selected session IDs, literal keywords, duration setting, quiet-hours setting and IANA time-zone identifier;
- revision and timestamps, without notification contents.

The Mac pushes the full normalized snapshot after setup and on each settings change/reconnect/time-zone change. `PUT` carries `expectedRevision`; `409` returns only the current non-secret revision. Local autosave may succeed while phone sync fails, but the shared footer must not claim everything is saved: Relay continues the last confirmed snapshot and the card reports the split until retry or an explicit conflict action succeeds. V0.4 documents one authoritative Mac controller.

### Event and policy rules

- Reuse the current `ReminderPolicy` behavior in a platform-neutral fixture suite. The relay implementation must match session-ID/keyword OR semantics, strict duration threshold, permission-event bypass, unknown-duration pass-through and quiet-hour boundary behavior.
- Never forward the event URL. Always construct exactly `https://<configured-HAPI-origin>/sessions/<percent-encoded-session-id>` and reject an invalid origin/session ID. No userinfo, alternate path, query or fragment is carried to ntfy.
- Notification title/body are fixed product text: completion uses “HAPI 任务已完成”; permission requests use “HAPI 需要你处理”. No session title, transcript, filesystem path, credential, tool output or `AGENT_NOTIFY_SUMMARY` body is sent.
- ntfy uses `Click`, `Title` and priority. Do not use delayed publishing for production completions. Acceptance requires a 2xx response with expected ntfy JSON, event type, matching topic and a nonempty provider-generated message ID; it does not require our event ID to be echoed or assume provider deduplication. An HTML or reverse-proxy fallback 200 is failure.

### Delivery and ACK

- Suppressed events are written to the relay's handled ledger before Hub ACK.
- Posted events are written as handled only after ntfy returns an accepted 2xx response, then ACKed explicitly.
- Process events strictly one at a time in increasing `seq`. Any delivery failure stops/cancels stream consumption at that head event; never ACK a later sequence. Recovery reconnects from the Hub ACK cursor.
- Network failure, timeout, 429 or 5xx does not ACK. Retry uses bounded exponential backoff with jitter and respects a bounded `Retry-After`, without another SSE or Hub polling.
- 401/403 from Hub stops the stream and requires device repair. ntfy 4xx pauses the head event and requires configuration repair plus explicit resume. This deliberate fail-closed queue blocking prevents a later ACK from skipping an undelivered event and must not hot-loop.
- A crash after ntfy acceptance but before local handling/Hub ACK can duplicate a notification. A stable event identifier is sent where supported, but public ntfy deduplication is never assumed. The contract is at-least-once without silent loss, with possible duplicates at this boundary.
- Relay restart reconnects and relies only on the Hub's server-side ACK cursor. It never advances from an SSE `Last-Event-ID` alone.

## Availability and privacy

- V0.4 depends on the selected ntfy service and the phone maintaining its ntfy connection. A successful POST proves provider acceptance, not handset display.
- The first release sends through public ntfy.sh: random topic, fixed title/body and HAPI session URL. The setup screen states this before enabling. Anyone who learns the topic can subscribe to future messages.
- The HAPI URL may itself reveal a private hostname and session identifier. The product must support a self-hosted HTTPS ntfy base URL later and must not hard-code ntfy.sh outside defaults.
- If the phone is unreachable, ntfy caching behavior is provider-controlled. The relay does not upload a second copy of message contents beyond the provider request.

## Operations and project boundaries

- Mobile Relay is a Bun/TypeScript Linux executable/package in this repository. The supported production baseline, CPU architecture and exact artifact are recorded before release.
- The baseline service runs as a dedicated non-root systemd user. The runbook fixes install/state/config paths, `0600` permissions, management port/reverse-proxy route, liveness vs authenticated readiness, log redaction, atomic state format, schema compatibility, bounded ledger retention (at least the Hub outbox TTL), and backup exclusions/encryption.
- The runbook sequence is preflight → verified backup → candidate install → liveness/readiness and fake-provider checks → service switch → real acceptance → rollback threshold. It covers clean install, N→N+1, N+1→N and uninstall without deleting retained state by default.
- Any HAPI patch change triggers a new patch SHA-256, clean-baseline compatibility run, explicit updater handoff and updater pin acceptance under `integrations/hapi/README.md`.
- `hapi-safe-updater` continues to own HAPI production upgrade gates. It does not become the Mobile Relay installer or updater unless that repository independently accepts such scope.
- A production VM install or reverse-proxy change requires operator approval, a clean pushed commit, backup, known rollback target and recorded runtime acceptance.
- Relay upgrades must preserve configuration and handled-event state and support rollback to the previous binary.

## Acceptance criteria

### Product and UI

- A1: after an installation Agent has installed and paired the Relay, phone setup completes with the Mac card, either QR or copy/paste subscription, one real test and one receipt/open confirmation; cancellation leaves no Hub Relay device. First-install acceptance separately proves endpoint, one-time pairing and secure credential storage.
- A2: QR and copy fallback, test, enable, pause, rotate, remove/incomplete removal, revision conflict and independent Relay/rules/provider states are understandable without exposing the topic in ordinary status.
- A3: existing Mac settings, notification behavior, sounds and Sparkle updates remain unchanged.

### Security and privacy

- A4: topic has at least 128 bits of entropy; secrets are absent from source, logs, UI status, test fixtures and release artifacts.
- A5: pairing-code entropy/TTL/single-use/rate limits and management bearer hashing pass; one instance cannot rebind Hub/device; stale revisions fail closed. Namespace isolation is supplied by the Hub-issued Relay device rather than caller input.
- A6: click actions are rebuilt as the exact configured HTTPS origin plus encoded `/sessions/<id>`; hostile event URLs, userinfo/query/fragment, redirects and malformed IDs are covered. ntfy base URLs require HTTPS, never follow redirects and enforce request size/time limits.
- A7: payload inspection proves no response body, transcript, filesystem path or HAPI/relay credential leaves for ntfy.

### Reliability

- A8: the relay has one SSE, no polling, strict sequence processing, ACK after durable suppression or accepted ntfy post only, ledger-hit ACK without repost, replay after restart and bounded retry for transient failures. Paused delivery keeps consuming, records suppression and ACKs with zero provider posts; resuming never replays paused events.
- A9: fault injection covers valid/invalid 2xx, 2xx-before-ledger, ledger-before-ACK, Hub 401/403, ntfy 4xx, timeout, 429 with `Retry-After`, 5xx, offline restart and configuration rotation; evidence proves at-least-once behavior and no later-sequence skip.
- A10: a shared fixture corpus proves Swift/Relay parity for session selection, keyword matching, duration equality/unknown, permission events and all quiet-hour shapes/time zones, including offline rule edits, explicit revision-conflict override/defer and time-zone resync.
- A11: a real VM candidate continues delivering while the controlling Mac is closed/asleep.

### End-to-end and release

- A12: OPPO receives a real qualifying completion with VPN explicitly off, locked screen and recorded time delta; one tap lands on a URL exactly equal to the target HAPI PWA session. QR and copy onboarding are recorded separately.
- A13: three real/fake-provider events prove short/nonmatching causes no POST, “只静音” requests priority 2 and its actual OPPO sound behavior is recorded, and “关闭全部提醒” creates ledger+ACK with zero provider request. If priority 2 is not reliably silent, the UI must describe observed behavior or offer suppress-only; it cannot promise silence.
- A14: with a deliberately unACKed event, service restart, N→N+1 and N+1→N preserve configuration/ledger hashes, replay correctly, avoid silent loss and return liveness/readiness. Backup and restore are exercised, not inferred.
- A15: doctor, Mac tests/build, Relay tests/build and clean HAPI patch hash/contract checks pass. If and only if the patch changes, clean-HAPI full suites plus updater handoff/pin acceptance are also required before release/deployment claims.
- A16: activation saga tests cover first success, same-ID retry, competing-ID 409, Hub-register success/Relay rejection compensation, unknown timeout recovery, cleanup failure, invalid committed credential repair and repeated Hub DELETE 404.

## Required human gates

The agent may design, implement, test locally, prepare review artifacts and a deployable candidate without interruption. Human action is required only for:

1. approving the first production VM service and public TLS reverse-proxy change;
2. entering/confirming the one-time pairing code only if the installation Agent cannot complete its authorized local transfer safely;
3. granting Android notification/background permissions, scanning or copying the production subscription and confirming the test;
4. final locked-screen, VPN-off, quiet-behavior and exact-session acceptance;
5. any external paid service, credential-policy or production deployment decision not already authorized.

## Evidence matrix

| Claim | Required evidence |
|---|---|
| Mac-independent delivery | Quit/close the controlling Mac app (and, where practical, sleep the Mac), complete a real Hub turn, record redacted event-id hash and ACK cursor, then verify phone receipt. |
| Exact OPPO delivery | Record ColorOS version, VPN off, locked screen, completion/receipt times and final `/sessions/<id>` URL after one tap. |
| Filtering and quiet behavior | Separate events for short, nonmatching, priority-2 and suppress modes; fake ntfy request count plus Relay ledger/ACK evidence; human observation only for actual sound. |
| Restart/upgrade/rollback | Seed an unACKed event, run restart/N→N+1/N+1→N, compare non-secret config/ledger hashes and verify replay/ACK/readiness. |
| Release provenance | Clean pushed Companion SHA, Relay artifact SHA/version/architecture/schema, test outputs, package smoke result, production service version and rollback target. |
