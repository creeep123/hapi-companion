# v0.2.2 Mac release — 2026-09-10

User accepted sounds/settings tabs and explicitly authorized normal release and local installation.

- Canonical branch: `main`; PR #10 contains accepted tabs, PR #11 contains release packaging/docs.
- Tag: `v0.2.2`, target `7de1a24112524040f908ad605f7b98109853ce93`.
- Build input: clean, pushed `b9e802d2acd739e72e66898ed82a565ce8717a1b`; its tree is identical to the release merge commit (verified with git diff).
- Public release: https://github.com/creeep123/hapi-companion/releases/tag/v0.2.2 — non-draft, non-prerelease, latest.
- App ZIP SHA-256: `3852a3448bfc0a0d3fc1f73546e9731ad939e181a1228af59e1dce77b6c36212`.
- Fresh derived-data packaging: 45 Swift tests, Release build and strict ad-hoc signature verification passed. Binary is arm64/x86_64, version 0.2.2/build 4, normal bundle ID, no preview flag, six new sound assets. Audio calibration checks passed.
- All three public assets were downloaded again and passed the published SHA256SUMS.txt. Release page and public UPDATE_MAC guide returned HTTP 200 without authentication.
- Installed the exact downloaded app at `~/Applications/HAPI Companion.app`; replaced old 0.2.0 bundle cleanly. Closed test/preview copies. Only the normal Companion process remains.
- Selected Runner settings file remained byte-identical. Existing selected sessions, duration threshold and quiet hours remained visible. Actual catalog loaded; own-process log reported `SSE connected status=200` at 11:42:48 local time.
- Native UI confirmed notification permission and login startup enabled. Both tabs worked; original sound and 80% app volume displayed. Test reminder reported success (banner submission and audio playback); a fresh real-task completion/click was not independently repeated during this deployment, following the user's prior acceptance.
- Only Companion's scoped device Keychain item was removed for ad-hoc replacement, following the existing installer policy. No credential values were read or printed.
- Rollback archive (ZIP integrity verified): `/Users/mayuming/Library/Application Support/HAPI Companion/Backups/HAPI-Companion-pre-v0.2.2-20260910-114222.zip`. Restore its app at the same canonical path, preserving preferences/audio and Runner configuration.
- Hub patch SHA-256 remains `2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd`; no Hub, Runner or updater deployment/pin change.

This release remains ad-hoc signed, not Apple-notarized. It has no in-app version checks or automatic updater. See [manual Mac upgrades](../agents/UPDATE_MAC.md).
