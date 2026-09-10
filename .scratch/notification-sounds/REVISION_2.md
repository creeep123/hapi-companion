# Sound revision 2
Status: done
Spec: docs/specs/NOTIFICATION_SOUNDS.md, revision 2.
Deliver fuller phone cues, measured loudness alignment and persistent app-only volume. Verify preset LUFS/true peak, volume application to all playback paths, legacy preference compatibility, custom import and quiet/ACK behavior; provide isolated preview for human listening.

## Evidence
- 45 Swift tests pass, including four new volume/migration tests. Existing quiet/ACK tests pass.
- Six calibrated presets measure -23.03 to -22.99 LUFS; true peaks -13.83 to -9.12 dBTP; durations 1.200–2.876 s. `python3 scripts/prepare-notification-sounds.py --check` passes, including input/output hashes.
- Original source AIFF unchanged; normalized copy preserves its timbre and timing. Five AOSP phone cues replace the rejected Kenney one-shots. Apache license/attribution is bundled; original OGG files retained for reproducibility.
- Volume defaults to 80%, persists separately from existing sound metadata, reaches both selected and fallback playback, and intentionally skips audio at 0%. Custom imports retain their own loudness, clearly stated in UI.
- Clean Release build uses a separate derived-data directory to exclude removed first-pack resources.
- No Hub, Runner, updater or live Companion configuration changes. Candidate is isolated preview; human listening acceptance pending.

## Native preview
- Clean universal Release build passed, strict ad-hoc seal verified. UI shows the preset picker and volume slider at default 80%, with app-only/zero-volume/custom-loudness explanations.
- User began interacting with the preview during the slider check; automation stopped without overriding their choice. Native slider endpoints/relaunch are left for human acceptance; unit tests cover the underlying gain and persistence behavior.
- Candidate is 0.2.2 with an isolated bundle ID and HAPISettingsPreview flag; double-click cannot pair or register a login item. Existing live Companion remains untouched.

## Final acceptance — 2026-09-10
User accepted this feature and authorized release. Published and installed as v0.2.2; see docs/deployments/V0_2_2_MAC_RELEASE.md. Earlier preview-only notes above are historical.
