#!/usr/bin/env python3
"""Offline preset calibration/check. Requires ffmpeg; never runs inside the app."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "docs/audio/LOUDNESS.json"
TARGET = -23.0
SOURCES = {
    "SoundOriginal": {"path": "Resources/HapiComplete.aiff", "minimum_duration": 1.0},
    "SoundPixieDust": {"path": "docs/audio/aosp-originals/pixiedust.ogg", "minimum_duration": 1.0},
    "SoundMoonbeam": {"path": "docs/audio/aosp-originals/moonbeam.ogg", "minimum_duration": 1.0},
    "SoundTejat": {"path": "docs/audio/aosp-originals/Tejat.ogg", "minimum_duration": 1.0},
    "SoundCapella": {"path": "docs/audio/aosp-originals/Capella.ogg", "minimum_duration": 1.0},
    "SoundCetiAlpha": {"path": "docs/audio/aosp-originals/CetiAlpha.ogg", "minimum_duration": 1.0},
    "SoundPixelCoinClear": {"path": "docs/audio/candidates/pixel/originals/coin-clear.wav", "minimum_duration": 0.2, "measurement_pad": 2.0},
    "SoundPixelCoinDouble": {"path": "docs/audio/candidates/pixel/originals/coin-double.wav", "minimum_duration": 0.3, "measurement_pad": 2.0},
}


def measure(path, measurement_pad=0):
    filters = []
    if measurement_pad:
        filters.append(f"apad=pad_dur={measurement_pad}")
    filters.append("loudnorm=I=-23:TP=-1:LRA=7:print_format=json")
    result = subprocess.run([
        "ffmpeg", "-hide_banner", "-nostdin", "-i", str(path),
        "-af", ",".join(filters), "-f", "null", "-"
    ], capture_output=True, text=True, check=True)
    data = json.loads(result.stderr[result.stderr.rfind("{"):result.stderr.rfind("}") + 1])
    duration = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)
    ], text=True)
    return {"lufs": float(data["input_i"]), "true_peak_dbtp": float(data["input_tp"]),
            "duration_seconds": round(float(duration), 4)}


def validate(values, minimum_duration=1.0):
    assert all(math.isfinite(x) for x in values.values()), values
    assert abs(values["lufs"] - TARGET) <= 0.5, values
    assert values["true_peak_dbtp"] <= -1.0, values
    assert minimum_duration <= values["duration_seconds"] <= 3.0, values


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify existing assets and manifest without edits")
    args = parser.parse_args()
    if args.check:
        saved = json.loads(MANIFEST.read_text())
        assert set(saved["sounds"]) == set(SOURCES)
        for name, config in SOURCES.items():
            output = ROOT / "Resources" / (name + ".wav")
            actual = measure(output, config.get("measurement_pad", 0))
            validate(actual, config["minimum_duration"])
            assert saved["sounds"][name]["sha256"] == digest(output), name
            assert saved["sounds"][name]["source_sha256"] == digest(ROOT / config["path"]), name
            assert abs(actual["lufs"] - saved["sounds"][name]["lufs"]) <= 0.1, name
            print(name, actual)
        return

    sounds = {}
    with tempfile.TemporaryDirectory(prefix="companion-calibration-") as temporary:
        for name, config in SOURCES.items():
            source = config["path"]
            decoded = Path(temporary) / "decoded.wav"
            calibrated = Path(temporary) / "calibrated.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(ROOT / source),
                            "-ar", "48000", "-ac", "2", "-c:a", "pcm_f32le", str(decoded)], check=True)
            before = measure(decoded, config.get("measurement_pad", 0))
            gain = TARGET - before["lufs"]
            # Constant gain preserves each cue's phrase, transients and decay.
            subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(decoded),
                            "-af", f"volume={gain:.3f}dB", "-c:a", "pcm_s16le", str(calibrated)], check=True)
            after = measure(calibrated, config.get("measurement_pad", 0))
            validate(after, config["minimum_duration"])  # Reject unsuitable sources instead of clipping.
            output = ROOT / "Resources" / (name + ".wav")
            output.write_bytes(calibrated.read_bytes())
            sounds[name] = dict(after, source=source, source_sha256=digest(ROOT / source),
                                measurement_silence_seconds=config.get("measurement_pad", 0),
                                gain_db=round(gain, 3), sha256=digest(output))
            print(name, after)
    MANIFEST.write_text(json.dumps({"target_lufs": TARGET, "tolerance_lu": 0.5,
                                   "maximum_true_peak_dbtp": -1, "sounds": sounds}, indent=2) + "\n")


if __name__ == "__main__":
    main()
