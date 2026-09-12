# Godot Universal MCP

Local-first MCP tooling for Godot: a **TypeScript/Node.js stdio server** plus a
**GDScript editor addon** and an optional development-runtime bridge.

**The addon does not require C# or a .NET Godot build.** A game that uses C# still
needs Godot .NET and the corresponding SDK to compile its own code. Native node,
scene and exported-property inspection uses Godot's APIs rather than assuming a
particular game scripting language.

## Architecture

```text
MCP client -- stdio / MCP --> Node.js server
                              | authenticated, loopback-only NDJSON TCP
                              +--> GDScript editor bridge (default 9500)
                              +--> GDScript runtime bridge (default 9501, opt-in)
```

Keep the public MCP protocol in the official Node SDK. The internal TCP bridge
is not itself a public MCP endpoint. See [the bridge guide](docs/BRIDGE_GUIDE.md)
for the language boundary, security model, migration notes and limitations.

## Run this checkout

Use Node.js 20 or newer and a Godot 4 editor. The integration matrix includes
Godot 4.3 standard and 4.4.1 .NET; it is a compatibility test matrix, not a claim
that these are the newest or recommended engine releases. Check the actual CI
results for the revision being installed.

```sh
git clone https://github.com/Noa3/GodotMCP.git
cd GodotMCP
npm ci
npm run build
```

When evaluating a pull request, check out its branch **before** building.
Copy the complete `addons/godot_universal_mcp` directory into your game's
`addons/` directory. Enable **Godot Universal MCP** under **Project > Project
Settings > Plugins**, then open a scene. Do not mix files from different addon
revisions.

Configure your client to launch the built file with absolute paths. Example
**VS Code** `.vscode/mcp.json` (replace both paths):

```json
{
  "servers": {
    "godot-universal": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/GodotMCP/dist/cli/index.js"],
      "env": {
        "GODOT_PROJECT_ROOT": "/absolute/path/to/your-game"
      }
    }
  }
}
```

On Windows, forward-slash absolute paths such as `C:/Projects/...` avoid JSON
backslash escaping. Other MCP clients may use a different outer configuration
key; the command, arguments and environment are the same. No `serve` subcommand
is needed. Using `npx` to launch a registry release does **not** test this checkout.
This guide makes no assumption that a matching npm release has been published.

The dock's **Copy Config** button generates this VS Code configuration after
`godot_universal_mcp/server_entry` is set in Project Settings to the absolute
built `dist/cli/index.js` path. The project token is not put on the clipboard.

## Authentication and write access

On first activation, the editor creates a random project-local credential at
`.godot/godot_universal_mcp/token`. The Node server reads that game's token before
each request. `GODOT_PROJECT_ROOT` must point to the game, not this server's repo.
The `.godot` cache must stay private and out of version control. An optional
`GODOT_MCP_TOKEN` override must be the same in the editor and server environments.

The MCP server defaults to read-only. To allow changes in a project you trust,
first initialize its config:

```sh
node dist/cli/index.js init-project /absolute/path/to/your-game
```

Then manually edit **only these fields** in the generated
`.godot-universal-mcp/config.json`, retaining the other settings:

```json
{"security": {"allowWrite": true, "trustMode": "trusted"}}
```

All registered write/destructive tools, including editor saves and process
launch/control, require both fields. Tool annotations are hints for clients, not
an alternative to this authorization. Possession of the raw bridge token grants
bridge access; this is **not a sandbox against other processes running as you**.
Only open and run projects you trust.

## Runtime inspection

Enable **Runtime bridge (next game run)** in the dock and launch the game using
the editor or an editor binary. The addon manages its own autoload entry.
The runtime listener is disabled by default and refuses normal export-template
builds, including debug exports. It remains responsive while gameplay is paused.
Changing the runtime checkbox takes effect on the next game run.

## Main bridge-backed MCP tools

| Public tool | What it actually does |
| --- | --- |
| `godot_editor_status`, `godot_editor_capabilities` | Read engine/project identity and supported operations. |
| `godot_editor_tree`, `godot_editor_get_node` | Inspect the current, possibly unsaved edited scene. |
| `godot_editor_set_node_property` | Typed property edit through editor Undo/Redo; trusted writes required. |
| `godot_editor_save_all`, `godot_editor_filesystem_scan` | Request scene saves or a filesystem scan. |
| `godot_runtime_status`, `godot_runtime_tree`, `godot_runtime_perf` | Inspect the running game through the opt-in bridge. |
| `godot_runtime_pause`, `godot_runtime_resume` | Pause/resume without pausing the bridge itself. |
| `godot_runtime_screenshot` | PNG JSON payload, longest edge capped at 1024; unavailable headlessly. |
| `godot_runtime_logs` | Bounded stdout/stderr from a process launched by this server. |

Editor nodes use paths relative to the edited root (`.` means the root).
Runtime nodes use paths relative to `/root`. Missing/unimplemented functionality
returns explicit errors: `godot_editor_output` does not yet capture the editor
console. Empty log arrays must not be treated as proof of an error-free game.
The existing project/file/offline scene/script tools remain available; their
textual analysis is not a complete Godot or C# compiler.

## Development checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
node --test tests/client.test.cjs
python3 tests/bridge_smoke.py --godot /absolute/path/to/godot
```

For the compiled C# fixture, use a Godot .NET binary and the matching .NET SDK:

```sh
python3 tests/bridge_smoke.py --godot /path/to/godot-dotnet --csharp --sdk-version 4.4.1
```

The smoke test creates a temporary project and exercises real editor/runtime
TCP connections, authentication, exported properties, typed writes, batching and
pause/resume. It does not replace GUI undo testing, rendered screenshot testing,
or exported-build validation. CI runs the engine fixtures separately from the
TypeScript/Jest checks.

## Documentation and license

[Bridge guide and migration](docs/BRIDGE_GUIDE.md) ·
[Security](SECURITY.md) · [Roadmap](ROADMAP.md) ·
[Contributing](CONTRIBUTING.md)

MIT License. See `LICENSE`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md`.
