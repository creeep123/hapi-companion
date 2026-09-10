# Selectable sounds
Status: needs-review
Spec: docs/specs/NOTIFICATION_SOUNDS.md

Deliver named licensed presets, custom import, preview and persistence. Validate malformed/missing imports and unchanged quiet/ACK behavior. Run existing Swift tests and Release build before handoff for listening acceptance.

## Verification — 2026-09-10
- 41 Swift tests passed (9 sound tests plus existing 32); Release universal build passed; doctor and git diff --check passed.
- Tested resource decoding, default/persisted settings, missing/corrupt sound fallback, import size/duration limits, replacement/removal, failed writes and malformed saved paths. Existing quiet/ACK regression tests pass.
- Native AX interaction in isolated preview verified six preset labels, selection of Pixel Upgrade, successful playback start without error, file picker and WAV import auto-selection. Subjective listening and real notification delivery are reserved for human acceptance.
- Review found new samples were louder than original; attenuated to original-level targets and repeated full tests/build. Preview custom copies now use a separate directory, and malformed custom paths recover to original.
- Hub patch unchanged: 2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd. No updater changes or production app replacement.

## Human acceptance
1. In the independent preview, try the six preset sounds and choose a preferred one; preview intentionally plays during quiet hours.
2. Import a short local file, preview it, quit/reopen and confirm selection is retained. Invalid/cancelled import should retain the previous choice.
3. After installing the normal candidate, confirm a real allowed completion uses the selected sound, while quiet/suppressed completions remain silent.

Preview uses fixture sessions, no Hub connection or login registration. The normal Release build includes the same sound feature for real notifications.
