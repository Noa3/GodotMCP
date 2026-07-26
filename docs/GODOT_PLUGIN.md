# Godot Plugin

## Files

- `plugin.cfg` — plugin metadata.
- `plugin.gd` — plugin lifecycle, dock registration, and bridge startup.
- `editor_bridge.gd` — editor TCP bridge.
- `runtime_bridge.gd` — optional runtime autoload.
- `dock.tscn` / `dock.gd` — dock UI and configuration helper.

## Enabling the plugin

1. Copy the addon into `res://addons/godot_universal_mcp`.
2. Open **Project > Project Settings > Plugins**.
3. Enable **Godot Universal MCP**.
4. Confirm the dock appears and the editor bridge starts.

## Project settings

The plugin registers these settings:

- `godot_universal_mcp/editor_port`
- `godot_universal_mcp/runtime_port`
- `godot_universal_mcp/runtime_enabled`
- `godot_universal_mcp/allow_runtime_input`
- `godot_universal_mcp/allow_eval`
- `godot_universal_mcp/allow_remote`
- `godot_universal_mcp/log_level`
