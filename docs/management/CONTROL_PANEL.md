# HAPI Companion Control Panel

**Last updated:** 2026-09-04  
**Owner:** creeep123  
**Canonical integration branch:** `main`  
**Current posture:** The working macOS prototype has been separated from a private HAPI maintenance tree. Core notification delivery works; repository hardening, visual identity approval, and first public baseline are in progress.

## 1. Current status

| Area | Status | Evidence | Next action |
|---|---|---|---|
| Product | Green | Native banner, bundled sound, and exact-session click path are implemented | Preserve the deliberately narrow scope |
| macOS client | Green | Swift 6 app; three unit tests pass on macOS | Add tests around configuration and PWA discovery |
| Hub transport | Yellow | Reviewed v26 outbox/SSE/ACK patch works on HAPI 0.29.0 | Rebase or upstream before claiming broad compatibility |
| Installation | Green | Fresh GitHub clone passed doctor and all seven tests on 2026-09-04 | Verify full install on a second Mac/account before binary release |
| Brand | Decision needed | Strategy and three directions are documented | Owner selects A, B, or C before final assets |
| Distribution | Yellow | Local ad-hoc build works | Developer ID signing/notarization remains future work |
| Repository | In progress | Local standalone Git repository initialized | Create and verify public GitHub remote |

## 2. Product boundary

### In scope

- one lightweight menu-bar process on macOS;
- HAPI completion events over one authenticated SSE connection;
- native banner and app-owned sound;
- click-through to the exact HAPI session;
- reuse of an existing Microsoft Edge HAPI PWA window;
- agent-readable installation and operational documentation.

### Out of scope

- a replacement HAPI client or runner;
- SQLite or HTTP polling;
- mobile clients in the initial release;
- Chrome/Safari PWA-window automation in the initial release;
- a hosted relay service;
- automatic production Hub patching or deployment.

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
| Public release artifact | none yet |
| Rollback for local app | reinstall the previously known-good app bundle |
| Hub rollback | prior Hub binary/container plus pre-v26 database backup |

## 5. Roadmap

| Milestone | Status | Done when |
|---|---|---|
| V0 repository baseline | In progress | clean commit is pushed; README, Control Panel, doctor, tests, and integration patch are verified |
| V0 brand baseline | Waiting on owner | one direction is selected; SVG/PNG/ICNS/menu-bar assets and rules are committed |
| V0.1 clean-machine install | In progress | fresh clone already builds; an agent performs the full install on a second environment without undocumented knowledge |
| V0.2 Hub compatibility | Backlog | patch is rebased to a tagged HAPI version or accepted upstream |
| V1 signed distribution | Backlog | Developer ID signed and notarized release is reproducible |

## 6. Decisions

1. **Name:** HAPI Companion. GitHub repository-name search returned no repositories named `hapi-companion` on 2026-09-04; legal trademark clearance was not performed.
2. **Transport:** durable SSE + explicit ACK, not a timer-based poller.
3. **Credential model:** device-scoped Keychain token after initial CLI-authenticated pairing.
4. **Navigation:** event URL is authoritative; discover the Edge PWA dynamically by Hub origin.
5. **Hub integration:** ship a documented patch while keeping local deployment details outside the generic project.
6. **License:** AGPL-3.0 to remain compatible with the included HAPI-derived integration.

## 7. Verification gate

```bash
./scripts/doctor.sh
xcodegen generate
xcodebuild -project HapiCompanion.xcodeproj -scheme HapiCompanion \
  -destination 'platform=macOS' -derivedDataPath .build \
  CODE_SIGNING_ALLOWED=NO test
git apply --check integrations/hapi/hapi-companion.patch  # from documented clean HAPI baseline
```

The first public baseline additionally requires a clean Git tree, a reachable GitHub remote, and visual identity approval.

Latest fresh-clone verification: remote `main` at `daa9416d8ab020681908c4e05abc3dcfe71a404b` passed `scripts/doctor.sh` and all seven unit tests on 2026-09-04.

## 8. Do not do

- Do not commit credentials, settings files, databases, or Keychain exports.
- Do not silently alter the configured Hub or copy deployment-specific domains into source.
- Do not ACK an event before both notification submission and sound playback start succeed.
- Do not reintroduce database/HTTP polling.
- Do not deploy the Hub patch without explicit operator approval, backup, full build, tests, and rollback record.
- Do not claim official HAPI affiliation, broad-version compatibility, notarization, or trademark clearance without evidence.
- Do not finalize brand assets before the owner selects a documented visual direction.

## 9. Kanban

| Backlog | Ready | In progress | Review | Done |
|---|---|---|---|---|
| signed release | clean-machine install | GitHub baseline | brand direction | working native delivery |
| upstream Hub proposal | config/PWA tests | documentation hardening | — | Control Panel |
