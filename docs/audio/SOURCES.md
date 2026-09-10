# Notification sound provenance — revision 2

The first Kenney pack was rejected during listening acceptance: cues were too short and the mean/peak matching method did not align perceived loudness. Its five bundled playback files have been removed. Original source/license notes remain available in Git history.

## Phone notification cues

Five cues now come from the **Android Open Source Project**, pinned to `1cdfff555f4a21f71ccc978290e2e212e2f8b168`. These are actual notification assets, rather than UI click effects. The [package license declaration](https://android.googlesource.com/platform/frameworks/base/+/1cdfff555f4a21f71ccc978290e2e212e2f8b168/data/sounds/Android.bp) explicitly applies Android-Apache-2.0 and lists these media files. Source OGGs are retained in `aosp-originals/`; attribution and Apache 2.0 text are shipped inside the app as `Audio-NOTICE.txt` and `Apache-2.0.txt`.

| Choice | Source under data/sounds | Duration |
|---|---|---|
| 星尘 · Pixie Dust | notifications/pixiedust.ogg | 1.729 s |
| 月光 · Moonbeam | notifications/moonbeam.ogg | 1.874 s |
| 双音轻铃 · Tejat | notifications/ogg/Tejat.ogg | 1.200 s |
| 明亮和弦 · Capella | notifications/ogg/Capella.ogg | 1.379 s |
| 电子回响 · Ceti Alpha | notifications/ogg/CetiAlpha.ogg | 2.876 s |

Original `HapiComplete.aiff` entered in initial commit daa9416. No external source attribution or generator was found in tracked history. Its bytes remain untouched; the picker now uses a normalized `SoundOriginal.wav` copy (1.650 s).

## Calibration standard and reproducibility

All six playback assets: stereo 48 kHz PCM16, **-23 LUFS integrated ±0.5 LU**, true peak **≤ -1 dBTP**. Measure after stereo conversion with FFmpeg's BS.1770/EBU R128 `loudnorm`, apply constant gain only (no compression, looping, trimming or changing the melody), then independently remeasure the exported WAV. Reject out-of-range outputs. [FFmpeg documentation](https://ffmpeg.org/ffmpeg-filters.html#loudnorm).

Measured results, gains, input/output SHA-256 hashes and durations: [LOUDNESS.json](LOUDNESS.json). Run `python3 scripts/prepare-notification-sounds.py` to regenerate from retained sources, or append `--check` to validate without edits. ffmpeg/ffprobe are build-time tools only, not app dependencies.

The source original measures -25.82 LUFS. All normalized presets at default 80% playback gain measure about -24.94 LUFS (roughly 0.9 LU above that baseline); 100% leaves headroom to be louder. The slider controls app playback only, not system output. At 0%, no sound is attempted. Custom imports retain their original loudness and use the same slider; they are not normalized automatically.

LUFS is a repeatable baseline, not a promise of identical subjective loudness for short cues. Frequency balance, duration and the Mac's speakers matter; human listening acceptance is still required.
