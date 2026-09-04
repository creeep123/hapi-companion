---
title: Initialize repo-native management system
status: ready-for-agent
owner: engineering
version: V0
specs:
  - docs/specs/V0_BASELINE_SPEC.md
---

## Objective

Install a lightweight document-driven project management system.

## Scope

- Add/update agent instructions.
- Add Control Panel.
- Add V0 baseline spec.
- Add branch and release provenance guardrails.
- Configure local markdown issue tracker docs.

## Out of Scope

- Product feature changes.
- Deployment.
- Auth/payment/DB/provider behavior changes.
- GitHub Issue migration.

## Acceptance Criteria

- [x] Agent instructions point agents to the Control Panel and local issue tracker.
- [x] `docs/management/CONTROL_PANEL.md` exists.
- [x] `docs/specs/V0_BASELINE_SPEC.md` exists.
- [x] Agent rules and the baseline spec require one canonical integration branch
      plus traceable production and rollback identifiers.
- [x] `docs/agents/*.md` describe issue, triage, and domain workflows.

## Files changed

- Agent instruction file
- `docs/management/CONTROL_PANEL.md`
- `docs/specs/V0_BASELINE_SPEC.md`
- `docs/agents/issue-tracker.md`
- `docs/agents/triage-labels.md`
- `docs/agents/domain.md`

## Verification command

```bash
find docs/management docs/specs docs/agents .scratch/project-management -maxdepth 2 -type f | sort
```

Initialized: 2026-09-04
