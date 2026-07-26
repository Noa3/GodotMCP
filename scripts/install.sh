#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_CONFIG="${1:-$ROOT_DIR/.mcp.json}"

mkdir -p "$(dirname "$TARGET_CONFIG")"
cp "$ROOT_DIR/.mcp.example.json" "$TARGET_CONFIG"

echo "Wrote MCP config to: $TARGET_CONFIG"
echo "Next steps:"
echo "  1. Open your Godot 4 project."
echo "  2. Copy addons/godot_universal_mcp into the project."
echo "  3. Enable the plugin from Project Settings > Plugins."
echo "  4. Run your MCP-compatible client with the generated config."
