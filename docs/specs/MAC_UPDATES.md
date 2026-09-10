# Mac updates — v0.3.0

User authorizes free research, implementation, publication and local installation. Canonical main; no Hub/updater changes.

Use Sparkle 2.9.6 (permissive open-source framework) and GitHub public release assets + a repository HTTPS appcast. No paid Apple membership or hosted service is required. Retain ad-hoc distribution; do not claim notarization.

UI: add an application update section in the secondary settings tab, version/build, Check for Updates and an automatic-check toggle. Sparkle standard UI handles available/latest/network error/download/install/relaunch. Daily background checks, no automatic installation without the user's choice, no system profile collection. Preview and XCTest never start an updater.

Security: dedicated Ed25519 key stays in login Keychain, only public key committed. Verify archive before extraction. Feed publication follows immutable release upload/verification; build numbers strictly increase. Preserve app prefs, imported sounds, selected HAPI directory and Runner state. Before confirmed install, delete only app-scoped device credential as the existing ad-hoc installer does, so the new app can pair without stale ACL prompts. Failed checks/downloads never delete credentials.

Acceptance: full existing tests; build normal universal app; inspect embedded Sparkle and configuration; manual current-version and network failure UI; actual older-build -> signed release download/install/relaunch with settings retained and SSE reconnected; background update discovery; archive tampering rejected; public docs/feed/assets; install release locally with rollback. Record limitations precisely. Old v0.2.2 needs one manual bootstrap.

Research: https://sparkle-project.org/documentation/ ; https://sparkle-project.org/documentation/programmatic-setup/ ; https://sparkle-project.org/documentation/sandboxing/ . Custom updater rejected because secure replacement/relaunch and recovery would duplicate a maintained framework. Homebrew alone does not provide in-app reminders. Paid distribution excluded by user requirement.
