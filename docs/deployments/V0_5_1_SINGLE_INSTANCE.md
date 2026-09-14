# V0.5.1 single-instance release evidence

Released 2026-09-14 after the user reported two menu-bar instances following a restart.

- Root cause evidence showed one installed process at `~/Applications/HAPI Companion.app` and one Xcode Debug process under `.build`, with only one installed app bundle and no duplicate login item.
- The first app process now holds a per-user nonblocking kernel file lock before UI, Keychain, login-item or SSE initialization. A second copy exits; crash/exit releases the lock.
- 71 Swift tests passed, including acquire/reject/release coverage. A clean universal Release build and ad-hoc signature verification passed.
- Real runtime acceptance launched separate Release and Debug app paths. Exactly one process survived. After the signed update, the installed v0.5.1 app was tested again against a Debug copy and remained the sole process.
- Immutable release assets were uploaded, re-downloaded and matched `SHA256SUMS.txt`. A real Sparkle 0.5.0 build 9 to 0.5.1 build 10 download/install/relaunch passed.
- The candidate feed override was removed. The canonical main feed passed byte-for-byte shell and native URLSession checks after CDN purge. GitHub reports v0.5.1 as the latest stable release.
- Existing sound selection data remained present. The Hub integration patch, updater pin, Relay and Runner configuration were unchanged.

Rollback: reinstall the retained v0.5.0 archive if needed. That version does not contain the single-instance guard, so do not launch a Debug copy alongside it.
