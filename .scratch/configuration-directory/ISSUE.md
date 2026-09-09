# 配置目录选择修复

Status: in-progress

Spec: docs/specs/CONFIGURATION_DIRECTORY.md

实现应用专属持久目录、HAPI_HOME 兼容、doctor/installer 一致选择。目标设备安装验收由 HAPI peer b9418690-f3b4-4284-a8f0-c536a843de5c 协作；保持两个 Runner 原状。验收按 spec 四项逐项记录，不保存凭据。

## Local verification
- 32 Swift tests passed; Release build passed.
- 7 shell path-resolution checks passed; zsh syntax and git diff --check passed.
- doctor passed for existing default configuration, without changing this Mac's installation or preferences.
- Hub patch hash remains 2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd.
- Remote runtime connection verification passed; native UI/catalog acceptance awaits the user.

## Prebuilt target-device installation
- Source: clean/pushed main b67e9efb6beaaf48ae0e523eb700f4e1f00d08fc, PR #6.
- Candidate: v0.2.0-candidate.b67e9ef, internal version 0.2.0, universal arm64/x86_64, ad-hoc signed (not notarized). Stable release unchanged.
- Archive SHA-256: 7edd677c0d5f09b693e96ab9e906ac02c8a5a0a2fc0f29e06b350d5e7f759d4b. Independently downloaded public asset matches.
- Target lacks full Xcode and XcodeGen. No developer-tool installation required for the prebuilt app.
- Existing app rollback archive is retained outside Applications on the target Mac.
- Follow-up: doctor currently checks existence of xcodebuild, which can mistake a CLT-only stub for usable Xcode; improve the source-build preflight separately.

## Target runtime evidence — 2026-09-09
Peer b9418690-f3b4-4284-a8f0-c536a843de5c reports:
- Installed candidate checksum matches; internal version 0.2.0, universal binary, strict ad-hoc signature verified without re-signing; only one app in Applications.
- App-specific saved directory points to the intended profile. Target origin corroborated from local request metadata. Initial auth and device registration returned 200.
- After `env -u HAPI_HOME open`, app PID 29806 emitted its own subsystem log `connecting device=…` then `SSE connected status=200`. Launch environment HAPI_HOME is absent. HTTP/3 explains the initial false negative from checking only TCP connections.
- Login item registered. No actual logout/reboot was performed.
- Both Runner settings files remain byte-identical to their pre-install hashes. Peer reports no Runner commands, process start/stop, or plist changes during this work. Runner PIDs did change; peer attributes this to existing launchd StartInterval=300 behavior. Do not claim process IDs stayed unchanged or treat this attribution as an independent Runner audit.
- Rollback archive retained under `~/Library/Application Support/HAPI Companion/Backups/companion-app-backup-pre-b67e9efb.tar.gz`; peer verified it matches the original temporary backup.
- No native UI-reading permission/tool on target. Real catalog display and visual notification flow are unverified; user asked to inspect the session list. External Keychain inspection was stopped after an authorization prompt, and is not acceptance evidence.

Connection-selection defect is resolved at runtime. Full installation/UI acceptance remains open; no Hub/updater changes were made.
