# V0.6 alpha.9 private VM shadow proposal

Status: prepared locally; production start requires a separate owner approval. The patched Hub, Runner and legacy Relay remain the only live notification path.

Use the [pre-start checklist](V0_6_ALPHA9_SHADOW_PRESTART_CHECKLIST.md) to record approval, VM baseline, effective resource limits, stop conditions and cleanup before any first start.

## Exact candidate

- Source: Companion implementation commit `f6386c23fcbb8366533a79e65a023cf29482bd7c`, documentation commit `4363a00cb0cc2f37bd3a74f1cf25bef01233442c`, against clean official HAPI baseline `0239edf38e2da653d662f31039e24ccea04c7837`.
- Architecture: Linux x86_64. Local frozen archive: `relay/dist/frozen-alpha9/hapi-companion-sidecar-0.6.0-alpha.9-x86_64.tar.gz` (excluded from Git); archive SHA-256 `ad2fca710ff82c21dc1495c43435e0e007f7ea54f2b3045cb644f379245fa543`.
- The executable inside that archive and its manifest agree on SHA-256 `64e60d9cec5bb740aaa93792afb72358d9905a2a1ec35180748ba2344b39eb33`. Manifest declares schema 2, management API 2 and consumer contract 1. The archive has been copied to a read-only local path; copying to the VM must verify the same archive hash before installation.
- An earlier alpha.9 archive had a different archive hash while the executable hash matched. The packaging script includes variable archive metadata, so the archive hash above identifies **this exact candidate**; neither an old hash nor a freshly rebuilt archive may be substituted silently.

The local gates passed: Relay typecheck and 178 tests, 75 Mac tests, 116 clean-official HAPI route/replay/namespace tests plus real auth/catalog/SSE handshake, and Linux x86_64 self-contained bundle smoke. These are local evidence, not a VM resource or real-device acceptance.

## Proposed first production shadow window

Only after separate approval, install the exact archive under `/opt/hapi-companion-sidecar` with private state under `/var/lib/hapi-companion-sidecar`. Run one process on `127.0.0.1:8791` for at most 30 minutes with `HAPI_SIDECAR_DELIVERY_MODE=shadow`. Do not enable it at boot, add a public Nginx route, change Mac/phone bindings or stop/restart the existing Hub, Runner or Relay. The shadow may open one authenticated official HAPI SSE connection; delivery rows must stay at zero. Its source credential uses the existing private systemd credential-file boundary and must never appear in environment text, commands, reports or chat.

The packaged service currently says `Restart=on-failure` and has no hard resource limits. The approved attempt would require an isolated systemd override *before first start*: `Restart=no`, `RuntimeMaxSec=30min`, `CPUQuota=5%`, `MemoryMax=128M`, `MemorySwapMax=0`, `IOWeight=10`. Verify the effective unit and loopback-only listener before observing events. Do not change the packaged unit or existing service. Monitor database plus WAL; the operational ceiling is 100 MiB.

Record 60-second CPU/RSS/write-rate samples at idle and during representative traffic, database/WAL size, fsync rate, source state and attention code, reconnect count and delivery-row count. Require at least four 75-second idle/reconnect cycles and one real Runner-generated `ready` observation matched privately against the patched path. Exercise Sidecar-only disconnect/resume and an isolated forced `resume=gap` without restarting the production Hub. The comparison report contains only counts, timing and keyed fingerprints; destroy its temporary key and report after the result is recorded.

Stop this attempt immediately on source attention/crash/restart, any delivery row, public listener or binding change, Hub/Relay health degradation, an invalid credential boundary, database plus WAL at 80 MiB, RSS above 100 MiB or resource throttling. Two consecutive 60-second ordinary-load samples above 1% CPU, 50 KB/s writes or 20 fsync/s also stop the attempt. Alpha.8's 215–431 KB/s writes and roughly 92 fsync/s are known failures. If representative traffic does not occur in 30 minutes, record the missing evidence and stop rather than extending the window implicitly.

## Stop and rollback

Stop the isolated Sidecar and confirm port 8791 closes. Confirm the original Hub, Runner and legacy Relay process identities and health, and that the legacy path remains the sole notification sender. Retain the isolated state for diagnosis only under private permissions. No production database rollback or Mac/phone setting change is needed because this attempt does not touch those systems. A failed shadow returns V0.6 to investigation; it never triggers automatic client cutover.

After a passing shadow, Mac banner/sound, OPPO click, offline ACK/replay and exact existing-window PWA navigation are still **unverified for the Sidecar transport**. They require a separately approved single-source cutover and human acceptance. Official SSE is not a durable event source; an event outside its bounded replay window can be missed, with no fixed maximum loss count.
