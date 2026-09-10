# HAPI Companion

<p align="center"><img src="brand/exports/hapi-companion-app-icon-1024.png" width="160" alt="HAPI Companion Signal Buddy app icon"></p>

<p align="center"><strong>Hear completion. Return exactly where the work happened.</strong></p>

<p align="center"><a href="https://github.com/creeep123/hapi-companion/releases/tag/v0.3.1">Download v0.3.1</a> · <a href="docs/brand/BRAND_GUIDELINES.md">Brand assets</a> · <a href="integrations/hapi/README.md">Hub integration</a></p>

Native, audible task-completion notifications for self-hosted [HAPI](https://github.com/tiann/hapi) on macOS.

HAPI Companion is a tiny menu-bar app for people who run coding agents through HAPI. It keeps one server-sent-events connection to your Hub, plays a bundled completion sound, shows a native macOS notification, and returns you to the exact HAPI conversation when you click it.

> Project status: v0.3.1 release for macOS 14+ and HAPI 0.29.0. The required Hub API is not yet part of upstream HAPI; this repository includes the reviewed integration patch.

## v0.3.1

Native settings now have two tabs for conversation/keyword rules, task duration, quiet hours and calibrated phone-style notification sounds with volume/custom import. Companion can persist its own Hub configuration directory independently of existing Runners. See [release notes](docs/releases/v0.3.1.md) and [updating an existing Mac](docs/agents/UPDATE_MAC.md). The reviewed Hub integration is still required for notifications, the session catalog and measured turn duration.

Free in-app updates are available under “声音与设置”: check manually or enable daily new-version reminders, then choose installation and relaunch. Sparkle verifies signed feeds and archives; public GitHub assets and the free jsDelivr CDN require no account or subscription. Older clients need one manual bootstrap; see [Mac update instructions](docs/agents/UPDATE_MAC.md). HAPI Safe Updater handles server updates only.

## Why it exists

Browser/PWA notifications are easy to miss on macOS: sound behavior depends on browser and OS policy, background delivery is inconsistent, and opening a notification does not reliably target an already-open PWA window. HAPI Companion owns only the desktop-notification job and solves all three problems natively:

- **Visible:** a native Notification Center banner.
- **Audible:** an app-owned sound, independent of Web Push sound policy.
- **Actionable:** clicking opens the event's exact `/sessions/<id>` route.
- **PWA-aware:** when an Edge-installed HAPI PWA is already open, the app raises and navigates that window instead of creating another one.
- **Lightweight:** one long-lived SSE connection; no database or HTTP polling loop.

## Agent quick start

**全新 Mac + 自有服务器，且需要后续安全升级：先读 [新环境安装引导](docs/agents/NEW_INSTALL.md)。** 本项目负责提醒；[HAPI Safe Updater](https://github.com/creeep123/hapi-safe-updater) 负责保留 Hub 补丁的安全升级。两个仓库任一入口均应引导 Agent 完成两边配置与验收。下方命令仅适用于已有兼容 Hub 的 Mac 安装。

This repository is intentionally installable by a coding agent. Give the agent this instruction:

```text
Clone https://github.com/creeep123/hapi-companion into ~/develop/hapi-companion.
Read AGENTS.md and README.md. Verify that HAPI CLI is logged in and that the Hub
has the Companion integration. Run ./scripts/doctor.sh, then ./install-local.sh.
Do not print or copy ~/.hapi/settings.json or any token. Report every failed check.
```

Or install manually:

```bash
git clone https://github.com/creeep123/hapi-companion.git ~/develop/hapi-companion
cd ~/develop/hapi-companion
./scripts/doctor.sh
./install-local.sh
```

Tagged releases also include an ad-hoc signed universal application, but it is not Apple-notarized. For security and predictable macOS permissions, the source installer above is the recommended path.

### Multiple HAPI configurations / choosing a Hub

If your Mac has several Runners, select the configuration belonging to the Hub you want:

```bash
./scripts/doctor.sh --hapi-home "$HOME/.hapi-work"
./install-local.sh --hapi-home "$HOME/.hapi-work"
```

Replace `.hapi-work` with your actual directory containing `settings.json`. The installer validates that directory and saves **only its path** in Companion preferences after a successful installation. Finder and login launches use that saved path; existing Runner settings are never modified.

Runtime precedence is saved `hapiHomeDirectory` → `HAPI_HOME` → `~/.hapi`. Without an existing saved choice, `HAPI_HOME=/absolute/path ./install-local.sh` also selects and persists that directory. A missing/invalid selected file fails instead of falling back to another Hub. To switch an installed compatible app without rebuilding, quit Companion, run `defaults write io.github.creeep123.hapicompanion hapiHomeDirectory -string "/absolute/config/directory"`, check `./scripts/doctor.sh`, then reopen it. Verify the host shown in settings and the real session catalog. Never paste tokens into commands or chat.

### Prerequisites

- macOS 14 or newer
- Xcode command-line tools / Xcode
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) available as `xcodegen`
- HAPI CLI installed, logged in, and connected to the intended Hub
- `~/.hapi/settings.json` containing the CLI's `apiUrl` and `cliApiToken`
- a Hub built with the Companion integration in [`integrations/hapi`](integrations/hapi/README.md)
- Microsoft Edge with the HAPI site installed as a PWA for same-window reuse (optional)

The installer builds locally, places `HAPI Companion.app` in `~/Applications`, launches it, and asks macOS to register it as a login item. On first launch:

1. Allow **Notifications**.
2. Keep notification style set to **Banners** or **Alerts**, with sounds enabled.
3. The first time you click a task notification, allow HAPI Companion to control Microsoft Edge. This automation permission is used only to focus and navigate the installed HAPI PWA.

## How it works

```text
coding agent finishes
        │
        ▼
HAPI Hub durable outbox ── SSE ──► HAPI Companion
        ▲                              │
        └──────── explicit ACK ────────┤
                                       ├─ native banner
                                       ├─ bundled sound
                                       └─ exact session URL → existing Edge PWA
```

The app reads the existing HAPI CLI settings only for initial pairing. It exchanges the CLI credential for a device-scoped token and stores that token in macOS Keychain. The SSE stream supports durable replay, explicit acknowledgement, reconnect backoff, and local event-ID deduplication.

## Verification

```bash
./scripts/doctor.sh
xcodegen generate
xcodebuild -project HapiCompanion.xcodeproj -scheme HapiCompanion \
  -destination 'platform=macOS' -derivedDataPath .build \
  CODE_SIGNING_ALLOWED=NO test

log stream --predicate 'subsystem == "io.github.creeep123.hapicompanion"' --level info
```

Use the menu-bar bell to test the bundled sound or a local notification. A real end-to-end test requires a HAPI session to complete after the Companion stream is connected.

## Exact-session behavior

For Edge PWAs, Companion discovers the installed app dynamically from `CrAppModeShortcutURL`; it does not hard-code a user's Edge application ID or Hub domain. On notification click it finds an existing HAPI window, raises the matching PWA, waits for Edge's app-mode restoration, and only then navigates that same window to the event URL.

If no installed PWA exists, Companion falls back to an Edge app-mode window, then to the default browser.

## Hub compatibility

HAPI Companion requires the durable notification outbox and three routes supplied by the included patch: device registration, SSE events, and explicit ACK. See [`integrations/hapi/README.md`](integrations/hapi/README.md) for the exact baseline, patch workflow, tests, and deployment boundary. Never apply the patch directly to production without reviewing and testing the resulting HAPI tree.

## Security and privacy

- CLI credentials are never committed or copied into this repository.
- The device credential is scoped to Companion and stored in Keychain.
- Notification events are isolated by HAPI namespace and Companion installation.
- ACKs are validated against namespace, sequence, and event ID.
- Logs contain truncated IDs and status messages, not tokens.
- Apple Events automation is limited to finding and navigating the matching Edge HAPI window.

## Project documentation

- [Control Panel](docs/management/CONTROL_PANEL.md)
- [Product and architecture](docs/PRODUCT.md)
- [Brand directions](docs/brand/BRAND_DIRECTIONS.md)
- [Brand guidelines and asset library](docs/brand/BRAND_GUIDELINES.md)
- [Hub integration](integrations/hapi/README.md)
- [Contributing](CONTRIBUTING.md)

## Current limitations

- macOS only.
- Existing-window targeting currently supports Microsoft Edge PWAs.
- Local ad-hoc builds re-pair after replacement. A public binary release should use Developer ID signing and notarization.
- The Hub integration is maintained as a patch until it is accepted upstream or published as a maintained HAPI fork.

## License

GNU Affero General Public License v3.0. HAPI Companion is an independent community project and is not presented as an official HAPI release.

## Choosing a notification sound

In the settings window, **提醒音效** offers the original completion tone plus five Android Open Source Project phone-notification cues (1.2–2.9 seconds). Click **试听** to preview deliberately; choosing a sound alone does not play it. Preview and test reminders bypass quiet hours, while real notifications keep the existing quiet/filter rules.

Use **导入音效…** to select a WAV, AIFF, MP3 or M4A file that macOS can decode (at most 10 seconds and 10 MiB). Companion keeps one replaceable copy in its own Application Support directory, so moving the original is safe. **移除自选** removes only that managed copy. Invalid imports leave the previous choice intact; an unavailable selected sound falls back to the original with visible feedback.

The choice is saved locally for this Mac, independently of per-Hub conversation rules; it is not synced to other devices. No Hub patch or updater changes are needed. Exact sources and licenses: [audio provenance](docs/audio/SOURCES.md).

Revision 2 aligns all preset playback files to -23 LUFS (±0.5 LU), with true peak below -1 dBTP. The **音量** slider controls Companion only (0–100%, default 80%) and survives restarts. Zero volume keeps banners but intentionally skips audio; imported files use the slider without automatic loudness normalization.

Settings are grouped into two tabs: **提醒规则** (default: conversations, task duration, quiet hours) and **声音与设置** (system settings followed by sound controls). Connection status and the test/autosave footer are shared. Switching tabs preserves existing values and unsubmitted search/keyword text.
