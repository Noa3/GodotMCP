# Bridge guide

## Setup and migration

Use the [single installation route](../README.md#one-supported-installation-route). Install from the actual built local package, not a similarly named npm server. The installer produces the Node adapter command, project identity and both client configuration formats; the dock copies that result. Re-run it after moving either project or server.

An older Coding-Solo server and a game-local adapter are different implementations, not alternative executable names for this addon. Update Node and the full addon together. The raw protocol is private NDJSON; public clients communicate MCP stdio with Node. All server logs go to stderr.

## Permissions and lifecycle

The plugin is the only runtime-autoload owner. `runtime_enabled=false` is the default. Runtime toggle on: register the known autoload and persist true. Toggle off or plugin disable: remove only that known entry and persist false. Editor close/reload alone does not remove configuration. A foreign script using the same autoload name is never overwritten. Existing running processes retain their current settings until stopped/restarted.

The runtime guard requires a debug editor binary running the game, not the editor scene tree and not export templates. It is development tooling, not a production remote control.

Server mutations need `security.allowWrite=true` and `trustMode=trusted`. Raw-token holders can talk to the bridge independently; these are separate boundaries, not a same-user sandbox. Addon property/input gates apply on the Godot side. Reading a custom property or snapshot provider can run trusted project code. Filesystem scans are write-classified because importers can modify files and execute code.

## Paths and limits

Editor node paths are relative to the edited scene root; `.` is that root. Runtime paths are relative to `/root`; `Main/Player` is a possible example, not a required structure. Absolute paths, parent traversal and invalid arguments are rejected. `scene_path` is an assertion about the current scene, not permission to instantiate arbitrary scenes from disk.

Tree depth is 0–12, node count 1–512. `truncated` marks incomplete output. Stored property inspection is bounded. The transport caps clients at 8, requests at 1 MiB, responses/queued output at 8 MiB, I/O at 64 KiB per client per poll and commands at 8 per client per poll. Idle connections expire after 120 seconds. Malformed input gets structured errors when an envelope can be returned; oversized frames/connections may be closed.

Each editor/runtime instance has a `sessionId`; status also includes project path, process ID and `protocolVersion`. Node checks canonical project identity, including before mutations. Ports still require explicit per-project configuration for simultaneous projects; automatic discovery is a future change.

## Readiness and mutation outcomes

`godot_editor_run_project` sends at most one start request and waits by default. Conditions include the correct project, a ready nonempty scene, a fresh session after a new launch, and optional expected scene/node. Already-running projects are checked rather than restarted. `wait_for_runtime=false` returns requested/ready=false, not a fabricated success. A disabled runtime bridge fails explicitly when waiting is requested.

`godot_runtime_wait_ready` polls observations only. `timeout_ms` is bounded to 100–60000, default 15000. Optional `session_id` fails on a different runtime. Connection time consumes the request deadline, so a late connect cannot dispatch a previously timed-out mutation. A timeout after sending still means the outcome may be unknown: observe before deciding whether to retry.

`godot_editor_stop_project` checks that editor play mode ended and that an observed runtime endpoint no longer responds. If no runtime was observed, the result explicitly says so. It does not claim to have killed an independently launched game. Managed-process tools own only their own subprocess and have separate stop semantics.

Editor progress dialogs can pump nested main-loop events. The transport blocks reentrant polling and consumes a frame before calling a handler; a play/save/import callback must never replay that frame.

Property edits are off by default. Enable `allow_editor_property_writes` or `allow_runtime_property_writes` explicitly. Only supported typed values are converted; script/owner/resource assignment is not offered. Editor writes use EditorUndoRedoManager and return readback; runtime writes return readback but have no undo guarantee. Saving is separate and explicit. Setters may clamp values or have side effects, so inspect the returned value.

## Semantic snapshot providers

Set `godot_universal_mcp/allow_snapshot_providers=true` only in trusted development projects. Add an existing or small adapter Node to the group `godot_mcp_snapshot_provider`. Implement **one** synchronous method named `get_mcp_snapshot`, returning a Godot Dictionary with JSON-compatible data.

```gdscript
extends Node

@export var observed_node: Node

func _ready() -> void:
    add_to_group("godot_mcp_snapshot_provider")

func get_mcp_snapshot() -> Dictionary:
    if not is_instance_valid(observed_node):
        return {"available": false}
    return {
        "available": true,
        "name": str(observed_node.name),
        "position": observed_node.position if observed_node is Node3D else null,
    }
```

This is a minimal example, not a second simulation. A real provider should read its project's existing services/save state and choose meaningful field names. C# providers must expose the exact Godot-visible `get_mcp_snapshot` method name and return `Godot.Collections.Dictionary`; normal C# game compilation is still required.

The bridge processes at most 16 providers. Values are encoded with limits and unsupported object values become descriptors, not serialized application objects. Providers must be read-only, fast and synchronous. The bridge cannot preempt a blocking getter/provider running in the engine's main thread. Providers should never return credentials or private data. Without a valid provider, `semanticSupported=false`; missing error telemetry is `last_errors=null`, never evidence of zero errors.

## Named input

Set `allow_runtime_input=true` and configure `allowed_input_actions` with names from **your own InputMap**. No movement or interaction action names are assumed. Query `godot_runtime_input_actions` to inspect the allowed subset.

`godot_runtime_send_action` accepts `action`, `phase` (`pressed` or `released`), optional strength 0–1 and `hold_ms` 1–1000. It creates InputEventAction and passes it to Input.parse_input_event so normal engine input handling receives it. A synthetic press auto-releases after the lease, even if the client disappears; the bridge continues processing while paused. It avoids initially taking over an already-held input, but interactive-user input and test input should not be mixed. Replay/recording and deterministic movement assertions are not yet implemented.

## Frame capture

`godot_runtime_screenshot` returns the most recent rendered main viewport. `godot_runtime_capture_frame` first waits for a ready runtime and additional **rendered** frames (`wait_frames`, default 2), pins its session and scene, then requests PNG output. The engine records metadata at the rendering lifecycle, not merely at the request time.

Default response: text/structured metadata plus an MCP `image/png` block. Explicit `encoding=base64` or `data-uri` supports older consumers. Metadata includes original and output dimensions, project/session, scene, process frame count, rendered frame count, engine uptime, active 2D/3D camera where available and Node-calculated SHA-256.

On older Godot versions lacking a current-render-method API, `renderer.actualMethod` is null and `configuredMethod` is separately labelled. It is not falsely presented as the active renderer. Headless capture is unsupported. This tool does not change camera, viewport, game state or window size; assertions across captures must compare their metadata. It does not save files or compute visual diffs. Import/layout/game-specific readiness beyond rendered scene readiness may require a provider assertion.

## Diagnostics and validation

Live `editor.get_output` and `runtime.get_logs` currently return NOT_IMPLEMENTED. Godot's newer Logger API can support real capture, but that needs a version-gated, thread-safe adapter and is not included here. Managed-process stdout/stderr is separate and labelled with source, timestamp, active state and process ID. No observed managed process means supported=false/logs=null.

The repository's headless and rendered tests use temporary projects. A general validation tool should accept named, locally configured checks and run them in an isolated workspace/profile. It must not accept shell strings, arbitrary executable arguments or reuse personal saves. That executor is not yet implemented; a normal project launch must never be reported as a successful build/smoke/UI acceptance run.

## Native Godot design references

- [EditorInterface](https://docs.godotengine.org/en/stable/classes/class_editorinterface.html)
- [EditorUndoRedoManager](https://docs.godotengine.org/en/stable/classes/class_editorundoredomanager.html)
- [Input](https://docs.godotengine.org/en/stable/classes/class_input.html)
- [RenderingServer lifecycle](https://docs.godotengine.org/en/stable/classes/class_renderingserver.html)
- [Newer Logger API](https://docs.godotengine.org/en/stable/classes/class_logger.html)
- [MCP tool image content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [Unity MCP instance design reference](https://coplaydev.github.io/unity-mcp/guides/multi-instance)
