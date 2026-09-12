# Godot Universal MCP addon

This GDScript addon belongs to the Node/TypeScript adapter in **Noa3/GodotMCP**. It does not use Coding-Solo's server or a game-specific `Tools/Godot` adapter. A normal Godot project needs no C# for this addon; C# gameplay still needs Godot .NET.

Build the server checkout, then run `node dist/cli/index.js install "/path/to/game" --enable` from that checkout. The installer copies the whole addon and generates `.godot-universal-mcp/client.json` and the project's MCP configuration. The dock copies those actual paths; it refuses to guess when configuration is missing or belongs to another project.

Runtime inspection is opt-in. The plugin owns its autoload, restores it after reload and removes it when explicitly disabled. Do not add a second static autoload entry. Stop and restart an already-running game after changing runtime settings.

Editor and runtime properties, input and snapshot providers have separate opt-in project settings. The adapter also requires trusted-write configuration for mutations. Possession of the raw project token remains privileged bridge access, not a sandbox.

See the server repository's README and `docs/BRIDGE_GUIDE.md` for setup, permissions, bounded schemas, readiness and feature limits. Tool names are generated from `tool_manifest.json`; never infer tool availability from a private handler name alone.
