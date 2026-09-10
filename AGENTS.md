# Agent Instructions

<!-- project-management-system:start -->

## Project management system

This repo uses a lightweight repo-native document-driven project management system.

Before major planning or implementation, read:

```text
docs/management/CONTROL_PANEL.md
```

Use version specs under `docs/specs/` to control scope. Use local markdown issues under `.scratch/<feature-or-version>/` for executable agent tasks.

## Source of truth hierarchy

When conflicts appear, follow this order:

1. `docs/management/CONTROL_PANEL.md`
2. Version specs in `docs/specs/`
3. Deployment docs in `docs/deployments/`
4. Local issue files under `.scratch/`
5. README / package scripts / existing source conventions
6. GitHub Issues, PR comments, and chat history

## Execution rules

- Do not expand product scope without updating the Control Panel or relevant spec.
- Keep the Control Panel readable by a product owner: explain user impact, value, progress, next decision, and risk in plain language.
- Keep technical precision in specs and `.scratch/` issues: exact scope, files, constraints, acceptance criteria, and verification commands.
- If a technical term must appear in the Control Panel, explain what it means in the same sentence.
- Every implementation task should have explicit acceptance criteria.
- Keep changes reviewable and scoped.
- For significant architectural decisions, add or update an ADR under `docs/adr/`.
- Do not print secrets, tokens, private keys, or full credential file contents.
- Do not modify auth, payment, storage, email, database migrations, production services, or deployment behavior without explicit approval.

## Deployment rules

Detected deployment signals: deployment target not declared. Do not deploy unless explicitly asked.

If asked to deploy, first confirm the intended provider/environment unless `docs/management/CONTROL_PANEL.md` already declares a canonical target.

## Companion / updater coordination rules

- For a fresh installation or repository-link handoff, read `docs/agents/NEW_INSTALL.md` before giving commands. Guide the user through both project roles and verify the requested end-to-end scope; never assume a compatible Hub or active upgrade protection already exists.

- This repository owns `integrations/hapi/hapi-companion.patch`, its API contract and compatibility tests. `hapi-safe-updater` owns patch pins, automatic upgrade gates, deployment execution and rollback implementation. Never add updater implementation here.
- Before modifying the patch, baseline, contract or compatibility tests, read `integrations/hapi/README.md` → “Patch change and upgrade handoff”.
- Every patch-content change requires a newly computed SHA-256 and an explicit handoff to the updater owner. Supply the immutable Companion commit, old/new patch hashes, target HAPI baseline, contract/migration changes, test evidence and rollback implications. Do not assume an updater update automatically refreshes its patch pin.
- The updater owner must update its pin and rerun upgrade acceptance. A message being delivered, a pin being edited, or a branch existing is not proof that production upgrade protection is active. Record the owner response, updater commit and acceptance evidence; keep missing evidence as an open task.
- Do not mark cross-project integration complete or declare a changed patch safe for automatic production upgrades until that handoff is confirmed. Companion-only changes that leave the patch and contract unchanged do not require a new patch pin.
- Upgrade acceptance and rollback requirements are defined in `integrations/hapi/README.md`; preserve single SSE + explicit ACK with no polling. Never include credentials in handoff messages, logs or evidence.

## Mac application updater rules

- For Mac app releases, read `docs/agents/RELEASE_MAC_UPDATES.md`. Keep update signing separate from server patch pins.
- Use pinned Sparkle, signed feeds and archives, monotonically increasing build numbers, and immutable release ZIPs. Never export or print the private update signing key.
- Verify actual native download/install/relaunch and Hub reconnection, retain rollback/settings, and remove acceptance feed overrides. Shell download success alone is insufficient.
- Publish verified archives before their signed feed; verify CDN propagation from the Mac before declaring a release done. No paid service or unrelated domain change is authorized by this updater design.

## Branch and release rules

- Record one canonical integration branch; do not infer that the current or default branch is automatically canonical.
- Use scoped feature/hotfix branches and integrate through review when pull requests are available.
- Deploy only a clean, pushed commit with a known Git SHA. Record the deployment/version identifier and rollback target.
- Do not close or delete a deployed hotfix/release branch until its production changes are contained in the canonical branch, or an explicit reconciliation task is recorded.
- An isolated release may exclude unsafe cumulative work, but its base, exclusions, production SHA, rollback, and reconciliation path must be documented. Never blindly merge divergent branches.

Useful scripts currently include:

```bash
./scripts/doctor.sh
xcodegen generate
xcodebuild -project HapiCompanion.xcodeproj -scheme HapiCompanion \
  -destination 'platform=macOS' -derivedDataPath .build \
  CODE_SIGNING_ALLOWED=NO test
./install-local.sh
```

## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature-or-version>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo: read `CONTEXT.md` and relevant ADRs under `docs/adr/` when present. See `docs/agents/domain.md`.

<!-- project-management-system:end -->
