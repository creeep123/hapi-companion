# Selectable notification sounds

Status: implementation and automated validation complete; ready for human listening acceptance. User authorized 2026-09-10.

- Existing settings window: named preset picker, explicit preview, import/replace and remove custom sound. No automatic preview on selection.
- Local app-wide selection (not synced and not per conversation), stored separately from existing per-Hub reminder rules. Default remains the original timbre via its calibrated playback copy; unknown selection falls back.
- Curate AOSP phone notification cues in revision 2, record exact source files, conversion and checksums. Existing sound source has no external attribution in repository history; do not invent it.
- Import WAV, AIFF, MP3 or M4A only if macOS actually decodes it, max 10 MiB and 10 seconds. Copy into app Application Support so moving the source does not break playback. One custom slot, transactional replacement, no deletion of originals. Invalid/cancelled imports preserve current selection.
- Missing/corrupt custom audio falls back to original with visible feedback. If fallback cannot start, existing non-ACK retry behavior remains. Quiet/suppressed events must never call playback. Explicit preview/test bypass quiet hours and say so.
- Acceptance: verify bundled decoding/duration, persistence/unknown settings, independent custom copy and replacement, invalid/oversize/long import, missing custom fallback, quiet-mode and delivery regression tests; full Swift tests and Release build; human preset/custom listening and real notification check on candidate. No Hub, credential, Runner or updater modifications.

## Revision 2 — phone-like cues and volume (2026-09-10)

User rejected the first pack as too short and quiet. Replace its five one-shot effects with licensed AOSP phone notification cues, roughly 1–3 seconds with a melodic phrase/decay. Keep the original timbre as the default but normalize its playback copy alongside the new cues. Source AIFF remains untouched.

- Presets target -23 LUFS integrated (FFmpeg BS.1770/EBU loudnorm), ±0.5 LU acceptance; true peak ≤ -1 dBTP. Record measured output duration, I, true peak and SHA in a reproducible manifest. LUFS is a level baseline, not proof of identical subjective loudness for short cues.
- Add app-only 0–100% playback volume, default 80%; persist separately so old sound/custom metadata decode unchanged and imports do not reset volume. Slider affects preset/custom/test/fallback consistently; never changes system volume. At 0%, intentional silence succeeds after banner delivery without invoking audio playback; failure at nonzero volume still blocks ACK.
- Custom audio is volume-controlled but is not automatically LUFS-normalized in this revision; communicate this in UI.
- Tests: volume default/migration/clamping/persistence, import independence, gain supplied to playback/fallback, zero-volume semantics, existing quiet/ACK tests; automated loudness verification and native slider/import preview acceptance.
