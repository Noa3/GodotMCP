# Godot Universal MCP

A local-first MCP server and GDScript editor/runtime addon for **arbitrary Godot projects**. The addon does not need C# or .NET. A game whose own scripts use C# still needs Godot .NET and its SDK.

```text
MCP client <-- stdio --> TypeScript / Node.js server
                              |
                    authenticated loopback TCP
                              |
                  Godot GDScript editor addon
                  optional development runtime
```

## One supported installation route

Keep the server checkout/package outside the game directory. Close the game's editor before installing or upgrading.

```sh
git clone https://github.com/Noa3/GodotMCP.git
cd GodotMCP
npm ci
npm run build
node dist/cli/index.js install "/absolute/path/to/your/game" --enable
```

On Windows, use your real Windows path, for example `"D:\Games\MyGame"`. The installer derives the Node executable, built server entry and game root from the actual installation; nothing depends on a particular game name or a `Tools/Godot` folder.

Open the game in Godot. The installer merges its `godot` entry into `.vscode/mcp.json` without removing other servers. For other clients, the dock's **Generic MCP client** checkbox selects the `mcpServers` form. **Copy Config** reads the same generated `.godot-universal-mcp/client.json`; it never guesses an npm package or another adapter.

Re-run install after moving the server or game, and restart the MCP client after updating the server. Server and **whole addon directory must be updated together**. Generated local configuration is machine-specific; do not treat it as a portable committed template. The repository is the authoritative installation source; this guide does not assume an npm registry release exists.

The installer refuses invalid/JSONC client configuration instead of silently overwriting it. Convert the relevant file to strict JSON or merge output from `mcp-config` manually. Replaced addon files are preserved in `.godot-universal-mcp/backups/`; changed configuration files receive unique `.bak` backups. Stop the editor before install/uninstall to avoid competing saves.

```sh
node dist/cli/index.js mcp-config --project-path "/absolute/path/to/your/game" --target vscode
node dist/cli/index.js mcp-config --project-path "/absolute/path/to/your/game" --target copilot-cli
node dist/cli/index.js doctor "/absolute/path/to/your/game"
```

A successful TCP connection alone is not proof of a compatible addon. Confirm `godot_editor_status` through your MCP client: the response must identify your project, protocol and editor session.

## Runtime and write permissions

Runtime inspection is **opt-in** using the Godot dock. The plugin owns the runtime autoload: enabling it adds its entry, disabling it removes only its own entry, and editor reloads recover the persisted state. Do not install a second independent runtime autoload. `install --autoload` requests this same plugin-managed opt-in. Changes apply to the next game run; disabling a plugin does not terminate a previously launched game.

The default server configuration is read-only. To authorize mutations in a trusted project, manually edit the `security` section in `.godot-universal-mcp/config.json`:

```json
{"allowWrite": true, "trustMode": "trusted"}
```

Keep the rest of that file. Godot property writes additionally require `godot_universal_mcp/allow_editor_property_writes` or `allow_runtime_property_writes`. Automated input additionally requires `allow_runtime_input` and an explicit `allowed_input_actions` list. None is enabled by installation. These gates are not a sandbox: trusted project scripts, property getters, setters and importers can execute code.

## Workflows

Use **status → verified start/readiness → snapshot → permitted action → readback → rendered capture → verified stop**.

`godot_editor_run_project` waits for runtime readiness by default and supports `timeout_ms`, `expected_scene` and `node_path`. An acknowledged play request is not immediately called a running game. `godot_runtime_wait_ready` can also be used independently. Session IDs prevent a restarted process being confused with the previous one. Timed-out mutations are never automatically replayed.

The shared manifest generates **27 bridge/workflow tools**, their strict MCP input schemas and the Godot-side validation. The [generated reference](docs/TOOL_REFERENCE.md) lists actual public names, not hypothetical tools. Existing offline file/scene/script tools and four managed-process tools remain available through `tools/list`; their text parsers are not full Godot/C# compilers.

`godot_runtime_snapshot` always reports engine state. Project-specific semantics are optional providers registered under `godot_mcp_snapshot_provider`; the core does not know player names, save types, day phases, residents or stations. See [the provider contract](docs/BRIDGE_GUIDE.md#semantic-snapshot-providers).

`godot_runtime_send_action` uses only explicitly allowlisted Godot InputMap actions. Synthetic presses have a bounded lease and auto-release; no eval, arbitrary method tool, Windows key injection or arbitrary subprocess arguments are offered by this bridge API.

`godot_runtime_capture_frame` waits for actual rendering and returns an MCP PNG image plus project/session, scene, frame, dimensions, camera and renderer provenance and SHA-256. It does not switch cameras or assume a viewport called `world`. Headless processes return unsupported errors. [Capture details and limits](docs/BRIDGE_GUIDE.md#frame-capture).

Live bridge logs currently return `NOT_IMPLEMENTED`, not misleading empty-success arrays. `godot_runtime_logs` is the separate bounded output of a process launched by that server context and reports `supported=false, logs=null` before such a process exists. Newer Godot Logger APIs are a planned optional adapter, not an implemented capability here.

## Security and multiple projects

Both listeners bind to `127.0.0.1`; the server accepts only loopback targets. Each game has its own random token under `.godot/godot_universal_mcp/token`. Tokens are not included in copied configuration. Treat the raw token as privileged local bridge access, independent of the Node server's read-only policy.

Default ports are editor `9500` and runtime `9501`. For concurrent projects, assign different port pairs in each game's Godot settings **and** its server `config.json` TCP section. Identity checks reject a wrong project; automatic port discovery and instance selection are not implemented yet. See [SECURITY.md](SECURITY.md).

## Validation and current scope

```sh
npm run build
npm run typecheck
npm run lint
npm test
npm run test:bridge
node scripts/generate-tool-reference.cjs --check
python tests/bridge_smoke.py --godot /path/to/godot
```

CI runs Node checks on Linux and Windows, actual Godot 4.3 Standard and 4.4.1 .NET fixtures, and a rendered 4.3 OpenGL/Mesa test using a real MCP stdio client. These versions are pinned compatibility fixtures, not a claim about the latest Godot release. Consult the PR's checks for actual results on a particular commit.

The fixtures use temporary projects and user data. **Ordinary `godot_run_project` is not isolated validation and may use the game's normal saves.** A general `project_run_validation` service still needs a reviewed, named-check/isolated-workspace contract; no consumer's `launch.py`, `.csproj` or personal saves are hardcoded into this server.

Not yet implemented: modern live Logger capture, automatic multi-instance discovery, full native scene/resource transactions, deterministic input replay, arbitrary viewport selection, camera positioning and screenshot comparison. GUI Undo/Redo and export-template behavior need additional direct tests. Dependency audit findings also remain to be remediated; passing CI is not a complete security audit.

## Design references and license

[CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp) is a useful design reference for instance identity, discoverable tools and project extensions. This implementation uses Godot's own SceneTree, EditorInterface, EditorUndoRedoManager, InputMap and rendering lifecycle rather than copying Unity-specific C# infrastructure.

This addon is **not** interchangeable with the Coding-Solo Godot MCP server or a consumer-specific `Tools/Godot/bridge_server.mjs`. Keep those configurations separately named; launch the adapter that belongs to the installed addon.

[Architecture](docs/ARCHITECTURE.md) · [Bridge guide](docs/BRIDGE_GUIDE.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

MIT License. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
