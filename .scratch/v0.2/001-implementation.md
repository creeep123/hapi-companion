---
title: V0.2 notification settings delivery
status: ready-for-human
owner: engineering
version: V0.2
specs:
  - docs/specs/V0_2_NOTIFICATION_SETTINGS.md
---

Objective: Implement the approved real-session/keyword settings window with duration and quiet-hours rules.
Scope/files: Sources, Tests, project.yml, integrations/hapi patch/docs, version/management/ADR docs.
Out of scope: updater, production install/deploy, database schema and credential-model changes, public release tag.
Acceptance: V0.2 spec A1–A9, with independent technical plan review before feature implementation and independent implementation review after tests.
Verification: scripts/doctor.sh; xcodegen generate; xcodebuild macOS test and universal Release build; clean HAPI baseline git apply --check, patched full tests/build; source review and native preview UI evidence.

Progress:
- 2026-09-08: baseline e12f1dd clean, scoped feature branch created; approved design saved; source reconnaissance completed, proposal ready for expert review.

- Technical expert review accepted after single-flight credential and turn-snapshot amendments.
- Client, policy and Hub integration implemented; 29 client tests and 6,787 Hub-repo package tests passed (4 skipped).
- Independent implementation P2 findings (legacy dedupe and right-click test action) fixed and re-reviewed.
- Native isolated preview UI exercised via Computer Use; actual screenshot in docs/design.
- Remaining operator gates and full evidence: docs/management/V0_2_ACCEPTANCE.md. No production installer/deploy/tag executed.
