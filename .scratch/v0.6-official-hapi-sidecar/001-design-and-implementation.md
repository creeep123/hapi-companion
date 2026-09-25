# V0.6 official-HAPI Sidecar

Status: implementation resumed with official structured-patch reducer; private shadow remains stopped; patched production remains authoritative

## Outcome

Replace Companion's runtime dependency on a locally patched HAPI Hub with a Companion-owned Sidecar that consumes official HAPI REST/SSE. An official SSE replay gap may lose any ready/task event outside available replay; once the Sidecar observes an event, downstream delivery remains durable with explicit consumer ACK and replay.

## Required deliverables

- Complete technical specification and ADR grounded in HAPI v0.30.7 official interfaces.
- Independent architecture/security/client review with findings resolved.
- Official-HAPI upstream adapter, event inference, gap reconciliation, durable downstream outbox and independent Mac/mobile consumers.
- Mac transport migration preserving settings, notification behavior and exact-session navigation.
- Deployment, upgrade, rollback and patch-retirement documentation.
- Unit, contract, failure, compatibility, package and client tests.
- No production deployment until an explicit production authorization and human acceptance gate.

## Design artifacts

- `docs/specs/V0_6_OFFICIAL_HAPI_SIDECAR.md`
- `docs/adr/0008-official-hapi-sidecar.md`

## Accepted product boundary

The product owner accepts that after an official SSE replay gap, a ready/task event outside available replay may be missed even when its message remains in history. Current pending input/permission requests are recovered from session state. This does not weaken Sidecar durability after observation: canonical commit, Mac ACK/replay and mobile delivery remain independent and durable within their documented provider limits.

## Execution checklist

- [x] Replace per-patch detail/catalog invalidation with versioned structured-patch reduction.
- [x] Commit only affected catalog rows and bounded cursor checkpoints for non-notifying traffic.
- [x] Preserve targeted request debounce/detail confirmation and malformed-patch fallback.
- [x] Pass unit, compatibility and package gates before creating a new shadow candidate.
- [ ] Pass the representative VM resource gate before any client cutover.

- [x] Inspect official HAPI v0.30.7 REST/SSE behavior.
- [x] Inspect existing Mac and Mobile Relay coupling.
- [x] Draft complete technical specification and ADR.
- [x] Resolve independent architecture/security/client review findings; final review at `61cda4de3bab925e0f30ba33bedc9719f948d4ec` is READY with no P0/P1 findings.
- [x] Implement official source adapter and fixtures.
- [x] Implement interpreter and gap reconciliation.
- [x] Implement durable store and independent consumers.
- [x] Migrate Mac transport binding without losing settings.
- [x] Complete unit, component, failure and clean-HAPI integration gates.
- [x] Update operations, rollback, upgrade and patch-retirement documentation.
- [x] Prepare a clean, reviewable candidate; do not deploy without explicit approval.

## Current evidence

- The resumed implementation follows the clean official HAPI v0.30.7 structured-patch contract. A 1,000-frame metadata stress test makes one catalog call, one startup detail call, at most 17 durable checkpoints and at most 40 full aggregate exports; it persists metadata version 1,000 and does not read messages.
- Local alpha.9 gates pass: 178 Relay tests, TypeScript, 75 Mac tests, Linux x64 compile and self-contained bundle smoke; the official HAPI gate passes 116 upstream tests plus the real auth/catalog/SSE handshake. Local archive SHA-256 is `7f4581cf9e2931cfaa52c4fa41b7a459e5c10b32e5401b4dd0c12c6f6ebba90f`; binary SHA-256 is `64e60d9cec5bb740aaa93792afb72358d9905a2a1ec35180748ba2344b39eb33`. These hashes identify the reviewed local package and are not deployment evidence.
- A later rebuild retained the same alpha.9 executable hash but changed tar metadata and therefore the archive hash. The exact archive reserved for a future VM shadow is frozen locally at `ad2fca710ff82c21dc1495c43435e0e007f7ea54f2b3045cb644f379245fa543`; verify those bytes at the VM before use. The [pre-start checklist](../../docs/deployments/V0_6_ALPHA9_SHADOW_PRESTART_CHECKLIST.md) remains entirely unexecuted on the VM and requires separate approval.
- Final independent specification and correctness reviews are PASS with no unresolved P0/P1/P2 finding. Review fixes cover whole-batch rollback, request-confirmation races, full-session replacement, version-zero wrappers, malformed structured values and malformed full Session/REST detail fallback.
- Reviewable integration is [PR #40](https://github.com/creeep123/hapi-companion/pull/40), built from immutable implementation commit `f6386c23fcbb8366533a79e65a023cf29482bd7c`. The PR is mergeable against canonical `main`; production and the stopped private shadow remain unchanged pending explicit authorization.

- Clean official HAPI checkout: `0239edf38e2da653d662f31039e24ccea04c7837`; 116 upstream route/replay/namespace tests and the real auth/namespace/catalog/SSE process gate pass.
- Relay: alpha.8 has 165 tests plus TypeScript passing, including zero-message gap recovery, request confirmation races, SSE-ID deduplication, atomic rollback, serialized cutover and bounded cursor batching.
- Mac: 75 tests pass; probe-before-save, failed-probe rollback and replaced-consumer revocation are covered.
- Candidate bundle: `0.6.0-alpha.8`; Linux x64 package smoke passes. Archive SHA-256 is `a22a11a0d1dbdb822f173bd394d8a00d52c4e420ff3af463beaf3fa15ad499fc`; binary SHA-256 is `a660d8042a1d56553e68c1ddaa14462cdaac75f6da1df14dee7725f4ecf0327b`.
- Independent final review: READY, P0/P1 zero. It confirms the Sidecar is isolated from the live Relay and that the shadow report can run under the deployed ownership model without exposing notification content or credentials.
- Historical production shadow ran alpha.4 on private loopback only. It is now stopped after alpha.7 exposed a bounded-pagination failure while reconciling a long session. The legacy Relay remains authoritative and healthy; no public Sidecar route or client binding was added.
- Alpha.8 at implementation commit `02ca15b1bd39e2606766c870b413286fa404845d` passed two independent final reviews with P0/P1/P2 all zero. Relay typecheck and 165 tests pass; the clean official HAPI v0.30.7 gate retains 116 upstream tests plus the real auth/catalog/SSE handshake.
- A copied-state isolated run recovered the real 230-session catalog from the former failing gap, cleared all legacy message watermarks, reached `live`, kept attention empty and produced zero delivery rows. Four consecutive 75-second idle/reconnect cycles stayed live with database integrity `ok` and the legacy Relay active.
- The isolated run observed one new real `ready` event and matched it to the authoritative patched outbox for the same session/kind with a 4.620-second creation-time delta; only booleans/counts/timing were emitted. The reviewed alpha.8 package then started once as the private loopback shadow. At that point it was live with schema 2, attention clear, zero restarts and zero delivery rows; the legacy Relay remained active on its original listener, and no public route or client binding was added.
- The subsequent production resource gate failed. A 60-second sample measured 6.115% CPU, 105,288 KiB RSS and about 431 KB/s writes; a second 30-second `pidstat` sample averaged 3.73% CPU, 89,666 KiB RSS and 214.8 KB/s writes. A syscall sample observed about 92 `fsync` calls per second. The source remained live and correct, so this was load rather than a crash loop.
- A content-free event-shape probe found frequent `session-updated` metadata wrappers during active work. Their nested values contain product-relevant fields such as name, lifecycle state, machine and flavor, so alpha.8 conservatively refreshed detail/catalog instead of discarding them. At that pause point, no alpha.9 had yet been created; the later reviewed alpha.9 uses official structured patches to update the affected session in memory.
- The private alpha.8 shadow was stopped and disabled. The pre-attempt integrity-checked alpha.5 database was restored, the binary pointer returned to alpha.5, port 8791 is closed, and the legacy Relay remains active on port 8789. No Mac or phone client was ever switched to the Sidecar.
- The first alpha.1 start failed closed because Linux systemd exposes `LoadCredential` through a root-owned read-only 0550/0440 mount. The service was immediately stopped and disabled while the live Relay remained active. PR #27 added the narrowly scoped credential-mount check, independent review returned READY with no P0/P1, and alpha.2 then started successfully.
- Earlier production evidence recorded source live, schema 2, ready observations, zero delivery rows, about 44 MB current RSS (63 MB peak), 4.3 MB private state and a healthy legacy Relay. Alpha.8 later passed the bounded correctness gates but failed the active-traffic resource gate described above.
- The production HMAC shadow-report command passed under the deployed service-user ownership model. Its output had version 1, a numeric high-water mark and only aggregate `ready` observations; forbidden content/credential field names were absent, and the temporary key/report were removed immediately.
- A Sidecar-only controlled restart returned the official source to `live`, kept attention clear and delivery rows at zero, advanced from the durable upstream cursor, and left the legacy Relay active. A production Hub restart remains intentionally untested because it can disrupt active sessions and requires its own maintenance authorization.
- The first production parity sample matched all 34 patched-Hub `ready` notifications after the cold-start boundary, with zero patched-only events. The Sidecar had one additional observation inside its first 30 seconds, which is classified as a baseline-window artifact pending the longer comparison. Matched observation-time delta was 186 ms median and 4.154 s maximum; no session identifiers or content were emitted during comparison.
- The subsequent two-hour parity sample matched all 31 patched-Hub `ready` notifications with zero observations unique to either path. Observation-time delta was 175 ms median, 1.7 s p95 and 3.41 s maximum. The comparison emitted counts and timing only.
- Initial steady-state measurement found about 2.45% of one CPU core, 154 KB/s of writes and 83 write calls/s, above the documented CPU budget. Alpha.3 stopped full-detail/catalog refreshes for allowlisted non-semantic patches; alpha.4 additionally batches their durable cursor/catalog commits while semantic and unknown patches remain fail-closed. Independent review of both changes ended READY with no P0/P1/P2 findings. Two consecutive alpha.4 samples measured about 1.00% and 0.83% CPU (0.92% combined), about 20 KB/s and 9.3 write calls/s, 68 MB RSS and 4.4 MB database plus WAL. Longer soak remains open.
- Historical patched-outbox counts explain the sparse rare kinds. Input/permission, task and completion remain covered by official-shaped fixtures and request-recovery tests; the bounded retry does not wait for all five kinds to occur naturally.
