# Notification sound provenance

Original `HapiComplete.aiff` entered in initial commit daa9416. No external source attribution or generator was found in tracked history; its origin is unverified. Preserved unchanged as the existing default.

New sounds: Kenney, CC0, downloaded 2026-09-10 from the official [Interface Sounds](https://kenney.nl/assets/interface-sounds) and [Digital Audio](https://kenney.nl/assets/digital-audio) pages. Original license texts accompany this file. Digital effects provide retro/pixel-style choices, not recordings from commercial games.

Converted from OGG to mono 48 kHz PCM16 WAV with ffmpeg. Each source is attenuated so decoded mean level is at most -31.5 dBFS and peak at most -14 dBFS, close to the existing tone (-31.5 mean / -14.1 peak); perceived loudness still requires listening acceptance. No trimming or other edits. Recipe: `ffmpeg -i input.ogg -af volume=<gain>dB -ar 48000 -ac 1 -c:a pcm_s16le output.wav`.

| Bundled file | Source within pack | Gain | SHA-256 (bundled WAV) |
|---|---|---|---|
| SoundConfirmation.wav | interface/confirmation_002.ogg | -16.6 dB | a4a19507934b35229026e0be312f7164c38510e70bf9a49bdc347b7cc7d540e9 |
| SoundGlass.wav | interface/glass_001.ogg | -13.0 dB | 1527263fbaad9a7168181d522eb7b1edbdcd82354e0cbdce8bd4bcdb6b20d711 |
| SoundPluck.wav | interface/pluck_001.ogg | -14.0 dB | 2e5a99649b140d25dc996f9bda3dcd80f65fd88c205d26a4ae7f3a2b546b77be |
| SoundPixel.wav | digital/powerUp4.ogg | -15.0 dB | f27756f83b06869d08c684b0386766fee6727e9192eec650644f66f884dcc5d2 |
| SoundDigital.wav | digital/threeTone1.ogg | -19.4 dB | 73a48c5f5801e13371348a779a5d51ea8c83b447d9b566ec2d838ec6e0308fd6 |
