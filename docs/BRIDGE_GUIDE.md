# Bridge architecture, compatibility and migration

## Language-neutral core

The addon is GDScript, not C#. Both standard and .NET editor builds can load the
same addon without an addon compilation step. C# games still need their own
compatible .NET toolchain; a GDScript addon cannot make the standard engine run
C# code. `csharpAvailable` probes the running engine's CSharpScript class, not
whether a project's assemblies successfully compiled.

Node/scene/property inspection uses native Godot APIs (`get_children`,
`get_property_list`, `get`, `set`, Script metadata). This covers native properties
and exports visible to Godot, not arbitrary private managed fields. C# [Tool]
and GDScript @tool scripts are used in the engine fixtures to make editor-time
property behavior reproducible. Runtime inspection operates on actual game
instances. Project code and property getters/setters may have side effects.

Keep language-specific compiler diagnostics and refactoring in optional future
providers: a GDScript language-server/headless adapter, and a C# language-server
or Roslyn adapter. Neither should become a hard dependency for all projects.
This change does not implement either provider.

## Private protocol

The MCP client communicates with the Node SDK over stdio. The server forwards
bridge tools over one TCP connection per editor/runtime endpoint using UTF-8
newline-delimited JSON. A request contains `id`, `type: "request"`, a canonical
command such as `editor.get_status`, a `params` object and a project `token`.
Responses preserve the id and return `type: "response"`, `ok`, `result`, `error`.
Errors have `code`, `message`, and `details`.

Public MCP names (`godot_runtime_tree`) are distinct from bridge commands
(`runtime.get_tree`). The registry tests guard this mapping. `get_capabilities`
reports protocol version 1, the bridge command list, language availability and
unsupported log capture. Transport connectivity alone does not establish that
the correct authenticated Godot project is connected.

Limits: eight clients per bridge, one MiB request frames, eight MiB response
frames/queued output, 64 KiB I/O and eight dispatched requests per client/frame,
and a two-minute idle timeout. The Node client caps pending requests at 128.
Scene-tree output is capped at 512 nodes; properties and collections have their
own truncation limits. These are engineering bounds, not a comprehensive denial
of service defense against trusted project code.

Responses are correlated by id. Disconnects settle outstanding requests. A
request is never replayed automatically after timeout or reconnection, because a
mutation may already have happened. Read the current state before retrying an
uncertain write. The bridge does not cancel an operation already dispatched.

## Editor correctness

The EditorPlugin owns the EditorUndoRedoManager and injects it into the Node
bridge. Edits use that manager with the target node as history context. JSON
primitives, Vector2, Vector3 and Color values are converted according to the
actual Godot property type. Unsupported assignments, unknown/read-only fields,
script changes and owner changes are rejected. Integer inputs must be integral
and fit the JSON safe-integer range.

Inspection only traverses the currently edited scene. It does not instantiate a
scene from disk just to read it, avoiding that former execution/leak path.
Supplying another scene path returns TOOL_NOT_AVAILABLE. Editor paths are
relative to the edited root, with `.` for the root. Absolute paths, property
subpaths and parent traversal are rejected. Existing offline .tscn tools are
separate textual tools, not authoritative scene/resource parsers.

Save/play/open operations report that an operation was requested rather than
pretending asynchronous work completed. Editor output capture and bridge-side
runtime logs explicitly return NOT_IMPLEMENTED. Managed-process stdout/stderr
is available separately; it is not a full Godot debugger/error stream.

## Runtime and exports

The runtime checkbox persists runtime_enabled and a path-owned autoload. State
is recovered from ProjectSettings after editor restarts instead of a transient
boolean. Disabling the addon removes only its own matching autoload entry.
Runtime settings take effect on the next game run.

The runtime node requires the editor feature tag, a debug-capable binary, and
explicit runtime_enabled. It does not listen in an editor scene preview or in
normal release/debug export templates. The bridge uses PROCESS_MODE_ALWAYS so
resume can be processed while SceneTree is paused. Export-template behavior
still needs a dedicated integration test; do not remove the runtime guards.

Screenshots reject headless/no-frame states and resize to a 1024-pixel longest
edge. They currently use a JSON/base64 response. Native MCP image blocks and
rendered-platform tests are future work.

## Upgrading from the initial implementation

1. Disable the old addon and stop the game and Node MCP server.
2. Update/build the server checkout and replace the entire addon directory,
   including bridge_transport.gd and value_codec.gd.
3. Re-enable the addon. The editor creates its local token. Set GODOT_PROJECT_ROOT
   in the MCP client configuration to the game project.
4. Restart the MCP server using the absolute built entry point. Verify
   godot_editor_status returns the expected project and capabilities.
5. Re-enable runtime inspection only when needed. Manually grant trusted write
   permissions in the game config only for a project you trust.

Old unauthenticated bridge clients will receive AUTH_REQUIRED. Updating only one
side is not supported. A token file change requires restarting the editor/game
listeners; the Node client rereads the file automatically. Deleting .godot
removes the token; enable/restart the editor addon to recreate it. Use distinct
port pairs for simultaneously open projects and match tcp.editorPort/runtimePort
in the server config to the game's Project Settings. Endpoint config changes
require restarting the server/listeners. No automatic multi-project discovery
or isolation is claimed.

## Security boundary and remaining work

Loopback binding is supplemented by a random per-project token. Keep .godot out
of source control; never paste a token into a bug report. The optional
GODOT_MCP_TOKEN override belongs in both process environments, not project.godot.
A token authorizes the private bridge; the Node server's read-only setting is
not a sandbox against someone who already has that credential. The managed
process tools execute project code and may accept explicit arguments in trusted
mode. Do not use this service for untrusted projects or remote/multi-tenant use.

Priorities after this repair: real debugger diagnostics; transactional Godot
scene/resource operations instead of regex edits; native MCP image results;
per-context managed-process ownership and shutdown; language-provider diagnostics;
and broader current-version/platform/export CI. Keep unavailable capabilities
explicit rather than returning successful placeholders.

## Primary API references

- [Godot editor plugins](https://docs.godotengine.org/en/stable/tutorials/plugins/editor/making_plugins.html)
- [C# requirements](https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/c_sharp_basics.html)
- [EditorUndoRedoManager](https://docs.godotengine.org/en/stable/classes/class_editorundoredomanager.html)
- [Pausing and process modes](https://docs.godotengine.org/en/stable/tutorials/scripting/pausing_games.html)
- [Feature tags](https://docs.godotengine.org/en/stable/tutorials/export/feature_tags.html)
