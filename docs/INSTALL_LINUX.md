# Install on Linux

## Prerequisites

- Linux with a recent glibc-based distribution
- Node.js 20+
- Godot 4.3+
- An MCP-capable editor or agent

## Steps

1. Clone this repository.
2. From the repository root, generate an MCP config:

```bash
./scripts/install.sh
```

3. Copy `addons/godot_universal_mcp` into your Godot project.
4. Enable the plugin from **Project > Project Settings > Plugins**.
5. Configure your MCP client to launch `npx -y godot-universal-mcp`.

## Validation

- The dock should appear after enabling the plugin.
- Godot should log that the editor bridge is listening on `127.0.0.1:9500`.
- Your MCP client should successfully call `editor.get_status`.
