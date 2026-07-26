# Runtime Bridge

The runtime bridge is an optional autoload that exposes inspection and limited mutation capabilities while a project is running.

## Intended use

- Inspect scene state during debug sessions.
- Read node properties and performance counters.
- Capture screenshots for AI-assisted debugging.

## Safety notes

- Only active in debug/editor builds.
- Disabled unless `godot_universal_mcp/runtime_enabled` is true.
- Binds to `127.0.0.1` by default.

## Recommended workflow

1. Enable the addon in the editor.
2. Register the runtime autoload if you need gameplay inspection.
3. Run the project from the editor.
4. Use `runtime.get_status` before invoking mutation tools.
