#!/usr/bin/env python3
"""Replace only the new enclosure URL, then let Sparkle re-sign the feed."""
import json
import re
import subprocess
import sys
from pathlib import Path

version, path = sys.argv[1:]
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
    raise SystemExit("Expected a numeric release version")
release = json.loads(subprocess.check_output([
    "gh", "api", f"repos/creeep123/hapi-companion/releases/tags/v{version}"
]))
name = f"HAPI-Companion-v{version}-macOS-ad-hoc.zip"
assets = [a for a in release["assets"] if a["name"] == name]
if len(assets) != 1:
    raise SystemExit("Publish exactly one matching app ZIP before preparing the feed")
asset = assets[0]
feed = Path(path).read_text()
old = f'https://github.com/creeep123/hapi-companion/releases/download/v{version}/{name}'
if feed.count(old) != 1:
    raise SystemExit("Expected exactly one new enclosure URL")
Path(path).write_text(feed.replace(old, asset["url"]))
