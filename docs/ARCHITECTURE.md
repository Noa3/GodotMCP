# Architecture

## Universal core

An MCP client communicates over stdio with the installed Node/TypeScript server. Godot editor/runtime endpoints use a private bounded NDJSON protocol over loopback, authenticated with a project-scoped token. The addon itself is GDScript and has no .NET requirement.

`addons/godot_universal_mcp/tool_manifest.json` is the authoritative bridge/workflow catalog. TypeScript expands it into strict JSON schemas and Zod validators; GDScript validates the same parameters from the same file. `scripts/generate-tool-reference.cjs` generates the reference document, checked for drift in CI. Legacy offline tools are separately registered and remain visible in MCP tools/list.

The installer resolves the actual adapter/package path and game directory. Both client configurations are generated once and stored locally; the dock copies them. Consumer launchers, scene names and gameplay services do not enter the core.

## Godot-native integration

Editor operations use EditorInterface, edited SceneTree nodes and EditorUndoRedoManager. Runtime input uses InputMap and InputEventAction; visual capture observes RenderingServer frame lifecycle and active viewport cameras. Start/stop workflows verify identity, session and runtime readiness. Transport reentrancy is blocked when editor progress dialogs pump nested events.

## Optional project semantics

Snapshot providers join `godot_mcp_snapshot_provider` and expose `get_mcp_snapshot`. They read existing gameplay systems rather than maintaining a second simulation. They are trusted project code and must be fast/read-only. Automated actions come from a project allowlist, never fixed game-specific names.

## Explicit boundaries

The plugin alone owns its runtime autoload. The Node server enforces read-only/trusted-write policy; Godot applies additional property/input gates. Token possession authorizes raw bridge access and is not a same-user sandbox. Calls are not automatically replayed after uncertain timeouts.

Future isolated validation must accept named, reviewed project checks and separate user data. It must not accept shell strings or pretend ordinary play mode is a test result. Automatic port discovery, live Logger capture and richer native transactions remain separate work.
