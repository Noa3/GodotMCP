# Troubleshooting

## The plugin does not appear in Godot

- Verify the addon is in `res://addons/godot_universal_mcp`.
- Reopen the project or trigger a filesystem scan.
- Confirm `plugin.cfg` and `plugin.gd` exist.

## The MCP client cannot connect

- Make sure the plugin is enabled.
- Confirm Godot logs show the editor bridge listening on `127.0.0.1:9500`.
- Check whether another process is already using the configured port.

## Runtime tools return unavailable errors

- Ensure the runtime autoload is enabled.
- Use a debug/editor build.
- Confirm `godot_universal_mcp/runtime_enabled` is set to `true`.

## AI actions feel unsafe

- Keep runtime and mutation capabilities disabled until needed.
- Review tool calls before accepting edits.
- Restrict usage to local development environments.
