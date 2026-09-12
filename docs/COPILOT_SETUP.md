# MCP client setup

Use [the local installer](../README.md#one-supported-installation-route). It merges a `godot` server entry into your game's `.vscode/mcp.json` without deleting other servers. The Godot dock's default Copy Config returns the same entry.

For clients using `mcpServers`, select **Generic MCP client** in the dock, or run:

```sh
node dist/cli/index.js mcp-config --target copilot-cli --project-path "/path/to/game"
```

The generated executable and project paths are installation-specific. After moving a checkout, regenerate them instead of editing a guessed npm command. In strict-JSON-only installer mode, existing JSONC is rejected without overwriting it; merge the generated server entry manually into a JSONC client file.

Confirm `godot_editor_status` returns the correct project/session, not just that a TCP port is open. Other MCP implementations must have separate configuration names and matching addons.
