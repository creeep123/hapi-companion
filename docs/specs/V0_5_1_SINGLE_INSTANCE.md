# V0.5.1 single-instance hotfix

Status: released and installed on 2026-09-14.

## Problem

The installed login-item app and a Debug build left by Xcode could run simultaneously. Both used the same bundle identifier and each created a menu-bar item.

## Required behavior

- At most one HAPI Companion process may run for a macOS user, even when copies live at different paths.
- The first process holds a nonblocking user-scoped file lock for its lifetime. A later copy exits before creating its model, status item, Keychain access, login item or SSE connection.
- A crash releases the operating-system lock automatically. A normal exit releases it explicitly.
- If the lock location itself is unavailable, log the failure and keep notifications available rather than silently leaving the user with no Companion.
- Existing settings, credentials, Hub patch, Relay and update schedule remain unchanged.

## Acceptance

1. A deterministic unit test proves the second claimant fails and succeeds after release.
2. Full Mac tests and Release build pass.
3. Launch the installed app and a second Debug copy; exactly one Companion process and one menu-bar item remain.
4. Publish through the existing signed Sparkle feed with a higher build number and verify update/relaunch/settings retention.
