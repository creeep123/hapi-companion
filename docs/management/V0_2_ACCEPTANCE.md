# V0.2 acceptance and handover

Date: 2026-09-08. Scope: docs/specs/V0_2_NOTIFICATION_SETTINGS.md A1–A9.
Status: implementation and automated review complete; live installation/Hub deployment and human sensory acceptance pending. Published production baseline remains v0.1.0. Implementation commit: `6d228a8`; draft PR #1 targets canonical `main`. Later provenance-only documentation commits do not change the tested implementation.

## Evidence matrix

| Requirement | Evidence | Result / limit |
|---|---|---|
| A1 retained menu icon / singleton window | AppDelegate retains NSStatusItem, 18pt template/fallback; CompanionWindowTests checks test guard and retained same window after close; native settings window actually launched | Window works; physical menu-bar icon location/click and real login/reopen need human verification because SystemUIServer inspection timed out |
| A2 approved lightweight controls | Actual native screenshot `docs/design/v0.2-settings-implemented.jpg`; Computer Use read native accessibility tree and clicked search, checkbox, add/remove keyword and quiet-mode controls in isolated preview | Search 小火胃 left exactly one row; checkbox changed selected count 2→3; added keyword appeared as removable chip; removal cleared it; quiet mode changed mute→suppress. Closing the native window then reactivating the app reopened one `companion-settings` window; ⌘, also focused it. Actual catalog fixture explicitly labelled preview; live Hub snapshot pending deployment |
| A3 policy semantics | ReminderPolicyTests + ReminderPreferencesTests | ID/title OR, Unicode literal matching, empty selection/keywords, strict threshold, invalid/missing duration, permission bypass, quiet bounds/midnight/all-day/local timezone/replay creation time; persistence/defaults/canonical-origin isolation |
| A4 delivery + retry | ReminderDeliveryTests, CompanionDeliveryGateTests, CompanionHandledEventsTests | Required failure prevents ACK; suppression records then ACKs; ACK failure + changed rule remains deduped; banner-only no sound; exact legacy replay UUID migrates to authenticated origin |
| A5 catalog/credentials | CompanionServiceTests + Hub route tests | Concurrent catalog/credential callers produce one auth/register; 401/404/501 catalog errors leave credential intact; no extra fetches; Hub rejects invalid/disabled/cross-namespace access and exposes minimal fields |
| A6 duration | Hub tracker/channel/route tests | Same-thinking/new start, end-state clearing, unknown start, immutable value during suspended channel, repeated completion, durable SSE replay; child tasks remain unknown |
| A7 legacy support | Optional tolerant event decoder tests, catalog unsupported tests, visible compatibility UI | Old notifications still work; old Hub cannot provide full catalog or known duration until patch upgraded |
| A8 regression/build | Swift XCTest and universal build logs; Hub verification report | See final counts below; live OS sound/banner are outside unit-test proof |
| A9 provenance/review | `.scratch/v0.2/002-plan-review.md`, `003-implementation-review.md`, `004-hub-validation.md`, ADR 0001, release notes and [draft PR #1](https://github.com/creeep123/hapi-companion/pull/1) | Independent plan review amendments implemented; two implementation P2 issues fixed and re-reviewed; no confirmed P1/P2 remain; no production deploy or public tag |

## Automated checks

- `./scripts/doctor.sh`: passed on local Mac, configured Hub Companion events endpoint present. This does not prove the new catalog endpoint exists in production.
- `xcodegen generate` and documented `xcodebuild ... CODE_SIGNING_ALLOWED=NO test`: 29 tests, 0 failures, including fake transport and isolated UserDefaults. Final rerun recorded after UI adjustments.
- `xcodebuild ... -configuration Release -destination 'generic/platform=macOS' ARCHS='arm64 x86_64' ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO build`: passed; `lipo -archs` independently confirmed `x86_64 arm64`.
- Hub all-package `typecheck` and `build`: passed. Unique package tests total **6,787 passed / 4 skipped**. Targeted 27 tests are included, not added twice. Node 25 WebStorage test-environment failure reproduces on clean baseline; test-only `NODE_OPTIONS=--no-experimental-webstorage` resolves it. Full details: `.scratch/v0.2/004-hub-validation.md` and `integrations/hapi/README.md`.
- Cumulative patch SHA-256: `2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd`; clean-baseline application verified. No v0.2 schema/store migration delta.

Local logs: `/tmp/hapi-companion-v02-swift-final-tests.log`, `/tmp/hapi-companion-v02-universal-build.log`, `/tmp/hapi-companion-v02-preview-build.log`; Hub log paths recorded in integration README. Reproducible commands and expected behavior are committed; temporary machine logs are not published.

## Human/production gate — not run automatically

The repository instructions require explicit approval for production changes. The user approved feature implementation, not deployment. Existing installed Companion and Hub were therefore left intact.

1. Approve the feature PR and identify the production Hub source/artifact/environment before deployment; compare that tree with the clean reference so local patches are not overwritten. Record its current SHA, artifact and rollback backup. The Companion repo does not currently declare a canonical deployment provider/environment.
2. With that operator approval, prepare/test the exact Hub deployment candidate containing catalog/duration support and deploy the complete Hub + embedded Web assets together. The cumulative patch is for clean baseline, not a patch-over-patch installer.
3. Approve/install the clean pushed Companion candidate with the existing installer after saving the v0.1 bundle. Confirm system notification/Edge automation/login-item permissions on the actual Mac.
4. Verify menu-bar icon click and app reopen bring forward one window; close it, complete a task and confirm background delivery continues. Verify login startup after sign-out/reboot.
5. Use real sessions: pick one and exclude another; keyword-match an existing and newly created/renamed title. Confirm selected ID survives rename; refresh lists real changes.
6. Set threshold 1 minute: short ready event skips, >1-minute foreground task reminds; unknown/background task and permission-request behavior match visible explanation.
7. Set quiet window covering now: mute gives banner/no sound; full suppress gives neither. Reconnect after quiet-period completion: no delayed sound/burst. Turn quiet mode off afterward.
8. Click a real notification: exact `/sessions/<id>` in the existing matching Edge PWA, no duplicate Edge web notification.

Manual test button bypasses all reminder rules and says it can play sound; it is not evidence that a real selected-session rule matched.

## Explicit remaining limitations

- Source/runtime previews cannot prove a human heard the sound or saw a production banner.
- Menu-bar crowding/third-party hiding remains OS-managed. A retained status item plus app-reopen/settings-command fallback solves access, but this iteration does not claim the original invisible-icon root cause was proven.
- Unknown turn duration passes through; no background-subtask timer is invented.
- Rules are per Hub origin on this Mac; they are not synchronized between devices.
- v0.2 remains an unreleased source candidate, without Developer ID signing/notarization.
