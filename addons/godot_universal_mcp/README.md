# Godot Universal MCP Addon

This addon exposes lightweight editor and runtime TCP bridges for the `godot-universal-mcp` Node.js server.

## Included files

- `plugin.gd` — Godot editor plugin entrypoint.
- `editor_bridge.gd` — localhost editor bridge for scene and project tools.
- `runtime_bridge.gd` — optional autoload for debug runtime inspection.
- `dock.tscn` / `dock.gd` — editor dock for status and setup shortcuts.

## Install

1. Copy `addons/godot_universal_mcp` into your Godot 4 project.
2. Open **Project > Project Settings > Plugins**.
3. Enable **Godot Universal MCP**.
4. If you want runtime inspection, enable the autoload from the dock or plugin helper.

See the repository `README.md` and `docs/GODOT_PLUGIN.md` for full setup guidance.
