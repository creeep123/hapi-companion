# Agent Issue Tracker

This project uses a local markdown issue tracker for agent-created implementation tasks.

## Location

Create issues under:

```text
.scratch/<feature-or-version>/
```

Recommended examples:

```text
.scratch/v0-baseline/001-baseline-audit.md
.scratch/v1-feature/001-vertical-slice.md
```

## Issue format

Use this frontmatter where helpful:

```yaml
---
title: Short task title
status: ready-for-agent
owner: engineering
version: V0
specs:
  - docs/specs/V0_BASELINE_SPEC.md
---
```

Each issue should include:

1. Objective
2. Scope
3. Out of scope
4. Acceptance criteria
5. Files likely to change
6. Verification command

## Source of truth hierarchy

When conflicts appear, follow this order:

1. `docs/management/CONTROL_PANEL.md`
2. Version specs in `docs/specs/`
3. Deployment docs in `docs/deployments/`
4. Local issue file under `.scratch/`
5. README / package scripts / existing source conventions
6. GitHub Issues, PR comments, and chat history

## GitHub note

If this repo has a GitHub remote, GitHub Issues can still be used for external collaboration, but agent-created implementation tasks default to local markdown unless the user explicitly asks to publish to GitHub.
