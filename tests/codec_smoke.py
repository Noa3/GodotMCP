#!/usr/bin/env python3
"""Run the engine codec regression without user projects or autoloads."""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--godot', required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='gumcp-codec-') as directory:
    root = Path(directory)
    (root / 'project.godot').write_text('config_version=5\n')
    addon = root / 'addons/godot_universal_mcp'
    addon.mkdir(parents=True)
    shutil.copy2(repo / 'addons/godot_universal_mcp/value_codec.gd', addon)
    shutil.copy2(repo / 'tests/codec_smoke.gd', root)
    result = subprocess.run([args.godot, '--headless', '--path', str(root), '--script', 'res://codec_smoke.gd'],
                            capture_output=True, text=True, timeout=30)
    print(result.stdout)
    print(result.stderr)
    assert result.returncode == 0 and 'PASS:' in result.stdout and 'SCRIPT ERROR:' not in result.stderr
