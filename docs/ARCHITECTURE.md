# Architecture

Godot Universal MCP is split into three layers:

1. **MCP server (Node.js / TypeScript)**
   - Exposes tools over stdio for MCP-compatible clients.
   - Validates requests, enforces safety checks, and formats responses.
2. **Editor bridge (Godot addon)**
   - Runs inside the Godot editor.
   - Listens on localhost TCP and serves scene, project, and editor operations.
3. **Runtime bridge (autoload)**
   - Runs inside the game in debug/editor contexts.
   - Exposes read-mostly runtime inspection plus carefully gated mutation tools.

## Data flow

```text
AI client <-> MCP stdio server <-> localhost TCP <-> Godot editor/runtime
```

## Core design principles

- **Local-first**: bridges bind to `127.0.0.1` by default.
- **Explicit capability boundaries**: editor and runtime tools are separate.
- **Safe defaults**: runtime access, eval, and remote access remain off unless enabled.
- **Portable setup**: no custom Godot build is required.

## Directory overview

- `addons/godot_universal_mcp/` — Godot plugin, bridges, dock UI.
- `docs/` — setup, architecture, security, and troubleshooting guides.
- `examples/` — minimal Godot projects for validation.
- `scripts/` — cross-platform install helpers.
- `src/` — MCP server implementation.
