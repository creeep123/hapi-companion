# Domain Docs

This repo uses a single-context documentation layout.

## Primary domain context

Use this file when present:

```text
CONTEXT.md
```

It should define domain language, product concepts, architectural boundaries, and important terminology.

## Architecture decisions

Use this directory for architectural decision records:

```text
docs/adr/
```

## Rule for agents

Before major planning or implementation, read:

1. `docs/management/CONTROL_PANEL.md`
2. Relevant files in `docs/specs/`
3. `CONTEXT.md` if domain understanding is needed and the file exists
4. Relevant README/plans/design docs and source conventions
5. Relevant ADRs in `docs/adr/` if they exist

Proceed silently if `CONTEXT.md` or ADRs do not exist yet. Create them only when useful decisions or domain terms need to be preserved.
