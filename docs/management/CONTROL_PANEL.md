# HAPI Companion Control Panel

**Last updated:** 2026-09-11
**Owner:** creeep123  
**Canonical integration branch:** `main`  
**Current posture:** v0.3.1 is publicly released and installed on this Mac. Free new-version reminders and in-app installation passed real download/relaunch, signed-feed/archive checks, Hub reconnection and retained settings; 47 tests pass. [Release evidence and rollback](../deployments/V0_3_1_MAC_UPDATES.md). No Hub/updater deployment.

## Active design — V0.4 Android exact-session notifications

The user approved design and implementation of a lightweight Android channel after an OPPO Find X9 Pro on ColorOS 16.0.10 received an ntfy notification and opened the exact HAPI PWA session with one tap. The accepted design adds a small VM Mobile Relay so phone delivery continues while the Mac sleeps, preserves one durable SSE plus explicit ACK with no polling, reuses existing reminder rules, and sends no session title or agent-response body. Independent product, architecture/security and test/operations reviews now report no blockers; implementation is starting with their remaining P1 gates in scope. The architecture reuses existing Hub APIs, so no HAPI patch or updater pin change is planned. Production VM changes and final phone acceptance remain human gates. Scope: [V0.4 specification](../specs/V0_4_ANDROID_NOTIFICATIONS.md). Architecture: [ADR 0005](../adr/0005-mobile-notification-relay.md).

## Active feature — selectable notification sounds

Revision 2 implements the user's listening feedback: the five short effects are replaced by actual AOSP phone-notification cues (1.2–2.9 seconds), and all six presets including the original timbre have calibrated playback copies. Their measured loudness differs by only 0.04 LU, a unit for comparing audio level. An app-only 0–100% volume slider defaults to 80% and survives restarts. Custom imports use the same slider but retain their own loudness. 45 Swift tests and automated audio measurements pass. Quiet hours and delivery/ACK behavior remain intact. No Hub patch or updater change. Scope and acceptance: [sound selection](../specs/NOTIFICATION_SOUNDS.md). The user accepted the sound functionality on 2026-09-10. The accepted two-tab layout and sounds are now included in the installed/public v0.2.2 release.

## Active UI refinement — settings tabs

User requested clearer grouping and lower prominence for sounds. Keep two tabs only: “提醒规则” (default: sessions, duration, quiet hours) and “声音与设置” (system settings followed by sounds). Connection status and test/autosave footer remain shared. Preserve all existing values, search text and keyword drafts when switching; no configuration migration or behavior changes. User accepted this layout and authorized release. Acceptance: [settings tabs](../specs/SETTINGS_TABS.md).

## Active iteration — V0.2 notification settings

**Local V0.2 installed; VM Hub V0.2 deployment and session-catalog acceptance completed on 2026-09-08.** The approved single-window settings are implemented: select real HAPI conversations or title keywords, skip short foreground tasks, and schedule quiet hours. Settings autosave locally. The menu-bar entry is retained explicitly and reopening the app opens settings as a fallback.

Independent technical-plan and implementation reviews are complete; both implementation findings were fixed. Client tests pass; Hub package tests total 6,787 passed / 4 skipped, with build and type checks passing. A baseline Node 25 test-environment issue is documented with a clean-source comparison. Local V0.2.0 is installed with a valid ad-hoc seal and healthy SSE connection; the VM Hub was subsequently upgraded and its catalog/SSE checks passed; v0.2.2 is now the public release; this paragraph records the earlier V0.2 deployment.

Scope: [V0.2 specification](../specs/V0_2_NOTIFICATION_SETTINGS.md). Evidence and exact manual steps: [V0.2 acceptance](V0_2_ACCEPTANCE.md). Candidate notes: [v0.2.0](../releases/v0.2.0.md). At that earlier milestone, canonical `main` was `cb6b48a`; feature PR #1 and installation fixes PR #2/#3 are merged.

**Next action:** other Macs can follow the public [update guide](../agents/UPDATE_MAC.md). New clients have daily optional update reminders and in-app installation; old clients require one manual bootstrap. Separate the remaining second-Mac visual acceptance from this Mac’s completed release. Updater implementation remains in `hapi-safe-updater`.

New-environment guidance: [Agent installation entry](../agents/NEW_INSTALL.md). Acceptance requires either public repository to lead an Agent through Mac Companion, a patched Hub and verified safe-upgrade configuration; an unmerged local document does not meet that requirement.

## Active fix — isolated HAPI configuration selection

Companion now persists its own configuration directory and displays the selected Hub host. PR #6 is merged at `b67e9ef`; 32 Swift tests, seven shell checks and the Release build passed. Doctor, installation and Finder/login startup share the selection. A [prebuilt installation candidate](https://github.com/creeep123/hapi-companion/releases/tag/v0.2.0-candidate.b67e9ef) is available for the second Mac, which has command-line tools but no full Xcode. The second Mac now runs the candidate against the intended Hub. Restarting with no HAPI_HOME still produces the app’s own “SSE connected status=200” log; both Runner settings files are byte-identical to their pre-install copies. Login startup is registered and a persistent rollback archive is retained. The peer cannot read native UI, so the real session list and visual notification flow remain pending human acceptance; v0.2.2 is now the stable release; the other Mac has not been upgraded by this session. It must never overwrite a Runner's settings or restart either Runner. Scope and acceptance: [configuration directory specification](../specs/CONFIGURATION_DIRECTORY.md). No Hub patch or updater pin change is required.

## Mac application updates

Completed in v0.3.1: open “声音与设置” for the version number, “检查更新…” and optional daily checks. New versions prompt the user to download, verify, install and relaunch. No subscription, account or paid server; Sparkle + public GitHub archives + free jsDelivr signed-feed delivery. No automatic installation without the user's choice. Existing v0.2.2 clients need one manual update to gain this capability. [User/Agent update guide](../agents/UPDATE_MAC.md), [release maintenance](../agents/RELEASE_MAC_UPDATES.md), [acceptance](../deployments/V0_3_1_MAC_UPDATES.md).

## 1. Current status

| Area | Status | Evidence | Next action |
|---|---|---|---|
| Product | Green | Native banner, bundled sound, and exact-session click path are implemented | Preserve the deliberately narrow scope |
| macOS client | Green | v0.3.1 universal app; 47 tests pass; real in-app upgrade and current Mac runtime verified | Preserve URL-origin and delivery guarantees |
| Hub transport | Yellow | Reviewed v26 outbox/SSE/ACK patch works on HAPI 0.29.0 | Rebase or upstream before claiming broad compatibility |
| Installation | Green | Fresh GitHub clone passed doctor and all tests; local installer is documented | Verify full install on a second Mac/account before signed binary release |
| Brand | Green | Signal Buddy approved; SVG/PNG/ICNS/menu-bar assets, tokens, guidelines, manifest, and checksums exist | Maintain assets through the generator |
| Distribution | Yellow | v0.3.1 has verified universal ad-hoc app, brand package, Hub patch, and checksums | Developer ID signing/notarization remains future work |
| Repository | Green | Public `creeep123/hapi-companion`, canonical `main`, release v0.3.1 verified | Maintain release provenance |

## 2. Product boundary

### In scope

- one lightweight menu-bar process on macOS;
- HAPI completion events over one authenticated SSE connection;
- native banner and app-owned sound;
- click-through to the exact HAPI session;
- reuse of an existing Microsoft Edge HAPI PWA window;
- agent-readable installation and operational documentation;
- one lightweight settings window with per-session/keyword rules, task duration filtering and quiet hours (V0.2);
- free Mac application update reminders and user-confirmed signed installation (V0.3.1).

### Out of scope

- a replacement HAPI client or runner;
- SQLite or HTTP polling;
- mobile clients in the initial release;
- Chrome/Safari PWA-window automation in the initial release;
- a hosted relay service;
- automatic production Hub patching or deployment.

### Companion 与自动更新项目的长期协作规则

- Companion 负责权威 Hub 补丁、接口约定和兼容性测试；独立 `hapi-safe-updater` 负责自动升级、部署和回滚。
- 修改补丁后，必须重新计算 SHA-256（用于锁定补丁内容的校验值），把新旧校验值、对应提交、目标 HAPI 版本、测试结果和回滚影响明确交给 updater 负责人；由对方更新 pin（升级器锁定的补丁版本）并重新验收。更新 updater 软件本身不等于已经更新补丁 pin。
- 对方确认新 pin 和升级验收通过前，不能宣布跨项目交付完成或允许自动升级使用新补丁；未完成的同步必须保留为明确任务。单纯发出消息不算验收完成。
- 用户于 2026-09-08 确认 updater 已在 `feat/companion-patched-hub-gates` 分支固化门禁，锁定补丁 `2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd`。该确认不代表分支已经合并或部署；实际运行状态由 updater 项目维护。
- 具体交接步骤、验收要求和记录模板见 [Hub 集成规则](../../integrations/hapi/README.md#patch-change-and-upgrade-handoff)。本仓库的 Agent 必须遵守 [AGENTS.md](../../AGENTS.md) 中的协作规则。

## 3. Architecture and sensitive systems

| Boundary | Current design | Guardrail |
|---|---|---|
| HAPI CLI settings | Read locally for initial pairing | Never print or copy token values |
| Keychain | Stores only device-scoped Companion credential | Delete only the scoped item during ad-hoc replacement |
| Hub auth | Existing user JWT creates installation-isolated device token | Treat auth-route changes as security-sensitive |
| Hub database | v26 durable outbox, device cursor, pruning | Backup before migration; rollback may require DB restore |
| Network | One outbound HTTPS/SSE connection to configured Hub | No local listener and no polling loop |
| Edge automation | Finds matching Hub origin and navigates that PWA window | Require macOS consent; do not inspect unrelated content |
| Notification Center | Displays title/body/session link | Do not place secrets in event bodies |

No payment, email, storage provider, analytics, advertising, or AI-provider SDK is present.

## 4. Baseline and provenance

| Item | Current value |
|---|---|
| Recommended local path | `~/develop/hapi-companion` |
| Canonical branch | `main` |
| GitHub target | `creeep123/hapi-companion` |
| HAPI integration baseline | `tiann/hapi@d3d4fd1706564782e9a58b917df4e0677f65051f` |
| Compatible HAPI line | 0.29.0 reference baseline |
| Current local production app | `~/Applications/HAPI Companion.app` |
| Public release artifact | `https://github.com/creeep123/hapi-companion/releases/tag/v0.3.1` |
| Rollback for local app | reinstall the previously known-good app bundle |
| Hub rollback | prior Hub binary/container plus pre-v26 database backup |

## 5. Roadmap

| Milestone | Status | Done when |
|---|---|---|
| V0 repository baseline | Done | clean commit is pushed; README, Control Panel, doctor, tests, and integration patch are verified |
| V0 brand baseline | Done | Signal Buddy baseline is approved; SVG/PNG/ICNS/menu-bar assets and rules are committed |
| V0.1 clean-machine install | In progress | fresh clone already builds; an agent performs the full install on a second environment without undocumented knowledge |
| V0.2 notification settings | Released | v0.2.2 accepted, published and installed; see deployment evidence |
| Future Hub compatibility | Backlog | patch is rebased to a tagged HAPI version or accepted upstream |
| V1 signed distribution | Backlog | Developer ID signed and notarized release is reproducible |

## 6. Decisions

1. **Name:** HAPI Companion. GitHub repository-name search returned no repositories named `hapi-companion` on 2026-09-04; legal trademark clearance was not performed.
2. **Transport:** durable SSE + explicit ACK, not a timer-based poller.
3. **Credential model:** device-scoped Keychain token after initial CLI-authenticated pairing.
4. **Navigation:** event URL is authoritative; discover the Edge PWA dynamically by Hub origin.
5. **Hub integration:** ship a documented patch while keeping local deployment details outside the generic project.
6. **License:** AGPL-3.0 to remain compatible with the included HAPI-derived integration.
7. **Brand direction:** Signal Buddy — a minimal coral task-complete pager character with a bell clapper and mint completion sparkle.

## 7. Verification gate

```bash
./scripts/doctor.sh
xcodegen generate
xcodebuild -project HapiCompanion.xcodeproj -scheme HapiCompanion \
  -destination 'platform=macOS' -derivedDataPath .build \
  CODE_SIGNING_ALLOWED=NO test
git apply --check integrations/hapi/hapi-companion.patch  # from documented clean HAPI baseline
```

The v0.1.0 tag targets `2752fa5ad9fb7b8515ba27d35535a914a8e19259`. All four downloaded release files passed the published `SHA256SUMS.txt`; the app archive is universal (`arm64` and `x86_64`) and its ad-hoc signature verifies.

Latest fresh-clone verification: remote `main` at `2752fa5ad9fb7b8515ba27d35535a914a8e19259` passed `scripts/doctor.sh`, brand regeneration/checksums, and all thirteen unit tests on 2026-09-05.

## 8. Do not do

- Do not commit credentials, settings files, databases, or Keychain exports.
- Do not silently alter the configured Hub or copy deployment-specific domains into source.
- ACK only after the required delivery succeeds, or a user rule intentionally suppresses and locally records the event. Sound is not required in explicitly silent mode; transient delivery failures never ACK.
- Do not reintroduce database/HTTP polling.
- Do not deploy the Hub patch without explicit operator approval, backup, full build, tests, and rollback record.
- Do not claim official HAPI affiliation, broad-version compatibility, notarization, or trademark clearance without evidence.
- Do not replace the approved Signal Buddy masters without a documented brand revision.

## 9. Kanban

| Backlog | Ready | In progress | Review | Done |
|---|---|---|---|---|
| signed/notarized release | clean-machine install | — | — | v0.1.0 source-first release |
| upstream Hub proposal | — | — | second-Mac visual acceptance | Control Panel and Signal Buddy brand |

## Mac update hosting

Canonical free update-feed source: `updates/appcast.xml` on reviewed `main`, delivered through jsDelivr's free public GitHub CDN at https://cdn.jsdelivr.net/gh/creeep123/hapi-companion@main/updates/appcast.xml. Feed and archives remain cryptographically signed. Immutable archives use GitHub Release Asset API downloads, without credentials. No paid account or new server. Release publication must purge the CDN feed cache and verify the public signed bytes.

GitHub Pages was evaluated but inherits the account's existing unrelated blog domain, whose route returns 404. It is not the update endpoint; do not alter that blog/domain. The experimental `gh-pages` branch contains only an index and initial signed feed; canonical implementation remains main.
