# Pixel notification sound candidates

Selected by the product owner on 2026-09-14 for the retained candidate library. These files are not bundled presets and do not change the installed application.

| Candidate | Original | Listening preview | Original duration | Padded-window preview loudness | Preview sample peak |
|---|---|---|---:|---:|---:|
| 像素金币 · 清脆 | `originals/coin-clear.wav` | `previews/coin-clear-preview.wav` | 0.24 s | -16.0 LUFS | -6.6 dBFS |
| 像素金币 · 双音 | `originals/coin-double.wav` | `previews/coin-double-preview.wav` | 0.35 s | -16.0 LUFS | -10.1 dBFS |

Source: FrogPog, [Chiptune SFX Pack](https://opengameart.org/content/chiptune-sfx-pack), dedicated to the public domain under CC0 1.0. The source page identifies `coin.wav` and `coin_2.wav`; OpenGameArt's stored filenames are `coin_1.wav` and `coin_2.wav`.

The preview copies were converted to stereo 48 kHz WAV and normalized for side-by-side listening with a two-pass FFmpeg EBU R128 filter. Because these cues are shorter than the normal measurement gate, a two-second silent measurement tail was used and removed from the exported preview. If promoted into the app, regenerate them through the production sound pipeline and its -23 LUFS/default-volume acceptance target instead of copying these listening previews into `Resources`.

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/
