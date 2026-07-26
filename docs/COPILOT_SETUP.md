# GitHub Copilot Setup

## VS Code

1. Install GitHub Copilot and ensure MCP support is enabled in your environment.
2. Copy `.vscode/mcp.example.json` to the location expected by your VS Code MCP integration.
3. Open your Godot project and enable the addon.
4. Start a Copilot session and verify `godot-universal` appears as an available server.

## Recommended workflow

- Use editor tools for scene and project inspection.
- Use runtime tools only while running a local debug build.
- Keep unsafe capabilities disabled unless a task truly requires them.

## Example configuration

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
