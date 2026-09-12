# Security policy

## Reporting

Report suspected vulnerabilities privately to the maintainer or through GitHub private vulnerability reporting if enabled. Include affected revision, reproduction steps, impact and mitigation. Do not post credentials, project tokens or personal game data in public issues.

## Development-only boundary

This is pre-1.0 local development tooling. Both Godot listeners bind to 127.0.0.1. The adapter accepts only loopback hosts and reads a project-specific token. Godot requires debug/editor-binary runtime use; export templates must not expose a listener. These guards are not a sandbox against project code or another process running with the user's permissions.

Possession of the raw token independently authorizes the private bridge. Node's read-only/trusted-write policy cannot constrain a different token-holding client. Property/input features additionally require explicit Godot settings. Getters, setters, importers, scripts and opt-in snapshot providers can execute project code. Only connect trusted projects and clients.

Runtime presses use an explicit InputMap allowlist and expire within one second. Property edits require supported types; editor writes use Undo/Redo and saving remains separate. The transport bounds messages/clients/work per poll and blocks reentrant dispatch caused by editor progress dialogs. Unknown mutation outcomes are never automatically replayed.

Ordinary project launch is not isolated validation and may use the game's real saves. The automated repository fixtures instead use temporary projects and user data. There is no arbitrary-shell validation tool or eval bridge command. A future validation API must preserve those boundaries.

The installer rejects symlink targets and invalid client JSON, retains backups and preserves unrelated client entries. Close the editor before changing installation. It is not a defense against concurrent hostile filesystem manipulation by the same user.

Dependency audit findings and a broader review of inherited offline tools remain open. Passing CI demonstrates only the tested behaviors, not complete security or compatibility. See the [roadmap](ROADMAP.md).
