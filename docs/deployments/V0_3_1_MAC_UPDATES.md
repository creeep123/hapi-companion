# v0.3.1 free Mac updates — 2026-09-10

User authorized research/design/implementation/publication and installation on the current Mac, with no paid services.

- Build source: clean pushed `d1342dac435ed8858eb540a8f3e8ab1008ffba18`; normal universal app v0.3.1/build 6. PR #14 merged at `a1953432aa4794288d914830525c16c53af24ebe`; v0.3.1 is now the stable/latest public release.
- ZIP SHA-256: `6e60de3f78391e99b7f2b7236ac461050ee247f9e77bbf7eda42bc14783716f7`.
- 47 tests pass, including preview isolation and actual host-bundle update configuration. Clean release build and nested signature verification pass; Sparkle license bundled.
- Archive authenticity: Sparkle's verifier accepts the published ZIP signature and rejects a copy with one byte changed. Native Sparkle rejected an unsigned/non-feed API response. Signed CDN XML passed native Sparkle validation.
- Actual native source build v0.3.1-rc.1/build 5 was compiled from pushed `44206fd` with explicit version overrides for acceptance. No source behavior was changed. Installed locally with an existing v0.2.2 compressed rollback backup.
- A scheduled check (last-check time cleared, no manual check call) discovered the signed build 6 from an immutable candidate feed. The update window offered v0.3.1; “Install Update” downloaded it, “Install and Relaunch” replaced/reopened the normal app at `~/Applications/HAPI Companion.app` at 12:13 local time.
- New process emitted its own `SSE connected status=200` at 12:13:13.743. Actual session catalog and selected nine sessions, 1-minute threshold and quiet hours remained visible. Stored reminder preferences and Runner configuration bytes remain identical. Original audio/default 80% remains the expected configuration. No stale Keychain authorization prompt occurred.
- No-update UI was verified against the earlier signed feed. Current app now supports Chinese UI through bundled locale declarations. Final native Chinese current-version and network-error dialogs both passed.
- Bootstrap backup ZIP (integrity verified): `/Users/mayuming/Library/Application Support/HAPI Companion/Backups/HAPI-Companion-pre-v0.3.0-20260910-120018.zip`. Restore its app without deleting preferences/audio/Runner settings if needed.
- All temporary SUFeedURL overrides were removed. The restarted normal app uses the canonical main CDN feed; native byte comparison and manual current-version check passed.
- Transport investigation: native github.com/raw.githubusercontent.com requests timed out; public API asset download works. Sparkle forces the RSS Accept header, so Contents API cannot host its feed. jsDelivr delivers the signed repository file without accounts/payment. CDN branch propagation must be verified from native URLSession, not only shell curl/purge replies.
- GitHub Pages experiment created an index/feed-only gh-pages distribution branch, but inherited unrelated blog routing is unusable. Pages API deletion returned 422; do not change the account blog. This branch is not used by the updater.
- Hub patch unchanged: `2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd`. No Hub/Runner/updater deployment or pin changes.

Distribution remains ad-hoc signed, not Developer ID signed or notarized. Older clients require one manual bootstrap; subsequent verified updates are initiated inside the app. No automatic installation without user choice.

## Final closure

- `swift scripts/check-update-feed.swift updates/appcast.xml` passed against canonical main after PR #14 merge and CDN purge. The app itself displayed “您使用的就是最新版！ HAPI Companion 0.3.1是当前的最新版本。” without a feed override.
- A temporary missing feed produced the native Chinese “更新错误！获取升级信息时出现错误，请稍后再试。” dialog; installed version and Hub settings stayed intact. The test override was removed and normal connectivity restored.
- All three public release assets were downloaded and passed SHA256SUMS. Installed app content matches the downloaded ZIP file-for-file and strict nested code-signature verification passes. Release/UPDATE_MAC page HTTP 200; release is non-draft, non-prerelease and latest.
- UI confirms v0.3.1/build 6, automatic checks enabled, notification permission/login startup enabled, original sound and 80% volume. Final test reminder reported successful banner submission and sound playback.
- Doctor passes. Existing stored reminder rules and the Runner settings file remain byte-identical to the pre-upgrade snapshots. The original 0.2.2 compressed rollback remains available.
- Free design and operations are recorded in the spec/ADR/release guide. No payments, Hub patch changes or updater pin changes occurred.
