# Troubleshooting

## Wrong adapter or moved installation

Rebuild this server, close Godot, and run `node dist/cli/index.js install "/path/to/game" --enable`. The generated client configuration must point to this package's `dist/cli/index.js` and set `GODOT_PROJECT_ROOT` to the game. A Coding-Solo server, old `npx` configuration or consumer `Tools/Godot` script is not interchangeable with this addon. Restart the MCP client after an update.

## Dock cannot copy configuration

Run the installer for this exact game. The dock rejects missing metadata, a different project root or a moved project. For a moved adapter, reinstall to regenerate its path. JSONC client configuration is not silently modified; convert it to strict JSON or merge the CLI-generated entry manually.

## AUTH_REQUIRED or INVALID_RESPONSE

Update the entire addon and server together. Start the editor addon so it creates `.godot/godot_universal_mcp/token`. Do not paste tokens into public logs. Project paths and protocol/session identity must agree. A reachable TCP port alone does not prove compatibility.

## Runtime not ready

Enable runtime in the dock, configure the game's main scene and restart the game. Use `godot_runtime_wait_ready` with a deadline and, where appropriate, expected scene/node assertions. For multiple projects, give each a distinct editor/runtime port pair in Godot settings and server TCP configuration. Automatic endpoint discovery is not available yet.

## Writes or input denied

The server must be explicitly trusted and allowed to write. Property mutations also need the relevant Godot `allow_*_property_writes` setting. Input additionally needs `allow_runtime_input` and the action name in `allowed_input_actions`. Use existing InputMap names, not OS key names. Read the returned value after a setter; saving is separate.

## No screenshot or logs

Screenshots require a rendering display and a completed render of the current scene. Use `godot_runtime_capture_frame`, not an arbitrary delay after launch. Headless mode is not a renderer.

Live editor/runtime bridge logs return NOT_IMPLEMENTED on this baseline. `godot_runtime_logs` is specifically managed-process stdout/stderr and is unsupported until such a process has been launched. Neither an unsupported source nor an empty captured subset proves absence of errors.

## Timeout after a mutation

Do not blindly repeat it. The command may have completed even if its response was lost. Recheck project/session and actual state before deciding what to do next. The adapter does not automatically replay mutations.
