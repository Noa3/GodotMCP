# Godot Universal MCP

Godot Universal MCP is a local-first Model Context Protocol server and Godot addon pair for AI-assisted Godot 4 development. It connects MCP-capable clients such as GitHub Copilot to a running Godot editor and optional debug runtime bridge.

## What is Godot Universal MCP?

The project provides:

- A **Node.js MCP server** that speaks stdio to your AI client.
- A **Godot editor plugin** that exposes scene, node, project, and play-mode operations.
- An optional **runtime autoload** for debug-time inspection during gameplay.
- Configuration, docs, and examples for reproducible setup.

## Quick start

### Windows PowerShell

```powershell
git clone <repository-url>
cd GodotMCP
.\scripts\install.ps1
```

Then copy `addons\godot_universal_mcp` into your Godot project, enable the plugin, and point your MCP-compatible client at the generated `.mcp.json`.

### Linux bash

```bash
git clone <repository-url>
cd GodotMCP
./scripts/install.sh
```

Then copy `addons/godot_universal_mcp` into your Godot project, enable the plugin, and configure your MCP client to launch `npx -y godot-universal-mcp`.

## Architecture overview

```text
AI client <-> MCP stdio server <-> localhost TCP <-> Godot editor/runtime
```

- The MCP server handles tool registration, request validation, and response formatting.
- The editor bridge exposes safe editor automation on `127.0.0.1:9500` by default.
- The runtime bridge exposes debug-only inspection on `127.0.0.1:9501` by default.

For more detail, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## VS Code / GitHub Copilot setup

Use either `.mcp.example.json` or `.vscode/mcp.example.json` as your starting point:

```json
{
  "servers": {
    "godot-universal": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "godot-universal-mcp"]
    }
  }
}
```

See [docs/COPILOT_SETUP.md](docs/COPILOT_SETUP.md) for a guided flow.

## How to enable the Godot plugin

1. Copy `addons/godot_universal_mcp` into your Godot project's `addons/` directory.
2. Open **Project > Project Settings > Plugins**.
3. Enable **Godot Universal MCP**.
4. Confirm the dock appears and the editor bridge starts.
5. Optionally enable the runtime autoload for gameplay inspection.

More details: [docs/GODOT_PLUGIN.md](docs/GODOT_PLUGIN.md).

## Safety model

Godot Universal MCP is designed for local development use:

- Bridges bind to `127.0.0.1` by default.
- Runtime inspection is intended for debug/editor builds only.
- Remote access and eval-style capabilities should remain disabled unless explicitly needed.
- AI-generated actions should be reviewed before applying destructive changes.

See [SECURITY.md](SECURITY.md) and [docs/SECURITY.md](docs/SECURITY.md).

## Tool categories

| Category | Example tools | Notes |
| --- | --- | --- |
| Editor inspection | `editor.get_status`, `editor.get_scene_tree`, `editor.get_node` | Best for scene understanding and project context. |
| Editor actions | `editor.set_node_property`, `editor.save_all`, `editor.open_scene` | Intended for local editor automation. |
| Project control | `editor.run_project`, `editor.stop_project`, `editor.filesystem_scan` | Helps coordinate iteration loops. |
| Runtime inspection | `runtime.get_status`, `runtime.get_tree`, `runtime.get_property` | Debug-only visibility into the running game. |
| Runtime control | `runtime.set_property`, `runtime.pause`, `runtime.resume`, `runtime.screenshot` | Powerful tools; use conservatively. |

See [docs/TOOL_REFERENCE.md](docs/TOOL_REFERENCE.md) for the full reference.

## Troubleshooting

- Plugin missing in Godot: verify the addon path and re-scan the filesystem.
- MCP client cannot connect: confirm the plugin is enabled and the editor bridge port is available.
- Runtime tools unavailable: ensure the runtime autoload is enabled in a debug/editor build.

Full guide: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## FAQ

### Does this bundle Godot?

No. You must install Godot separately.

### Does it work in production builds?

The runtime bridge is intended for debug/editor builds, not production deployment.

### Do I need VS Code?

No. Any MCP-compatible client can launch the stdio server.

### Is remote access enabled by default?

No. The default posture is localhost-only and safety-first.

## Additional documentation

- [Install on Windows](docs/INSTALL_WINDOWS.md)
- [Install on Linux](docs/INSTALL_LINUX.md)
- [Runtime bridge](docs/RUNTIME_BRIDGE.md)
- [Roadmap](ROADMAP.md)
- [Contribution guide](CONTRIBUTING.md)

## License

Licensed under the MIT License. See `LICENSE`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md`.
