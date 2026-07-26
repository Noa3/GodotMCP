# Install on Windows

## Prerequisites

- Windows 10 or 11
- Node.js 20+
- Godot 4.3+
- A client with MCP support, such as VS Code with GitHub Copilot

## Steps

1. Clone this repository.
2. Open PowerShell in the repository root.
3. Generate an MCP config:

```powershell
.\scripts\install.ps1
```

4. Copy `addons\godot_universal_mcp` into your Godot project.
5. In Godot, open **Project > Project Settings > Plugins** and enable **Godot Universal MCP**.
6. Point your MCP-capable client at `.mcp.json` or copy `.vscode\mcp.example.json` into your editor configuration.

## Validation

- Confirm the dock appears in the Godot editor.
- Confirm the editor bridge listens on port `9500`.
- Run your MCP client and call `editor.get_status`.
