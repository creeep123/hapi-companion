# Selectable notification sounds

Status: implementation and automated validation complete; ready for human listening acceptance. User authorized 2026-09-10.

- Existing settings window: named preset picker, explicit preview, import/replace and remove custom sound. No automatic preview on selection.
- Local app-wide selection (not synced and not per conversation), stored separately from existing per-Hub reminder rules. Default remains HapiComplete.aiff; unknown selection falls back.
- Curate CC0 Kenney short interface/digital effects, record exact source files, conversion and checksums. Existing sound source has no external attribution in repository history; do not invent it.
- Import WAV, AIFF, MP3 or M4A only if macOS actually decodes it, max 10 MiB and 10 seconds. Copy into app Application Support so moving the source does not break playback. One custom slot, transactional replacement, no deletion of originals. Invalid/cancelled imports preserve current selection.
- Missing/corrupt custom audio falls back to original with visible feedback. If fallback cannot start, existing non-ACK retry behavior remains. Quiet/suppressed events must never call playback. Explicit preview/test bypass quiet hours and say so.
- Acceptance: verify bundled decoding/duration, persistence/unknown settings, independent custom copy and replacement, invalid/oversize/long import, missing custom fallback, quiet-mode and delivery regression tests; full Swift tests and Release build; human preset/custom listening and real notification check on candidate. No Hub, credential, Runner or updater modifications.
