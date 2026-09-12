# Security Policy

## Supported versions

This project is pre-1.0. Security fixes are applied on the default supported branch for the latest release line. A successful test run is not a complete security audit.

## Reporting a vulnerability

Please do not open public GitHub issues for suspected security vulnerabilities.
Report issues privately to the maintainers with a description, affected surfaces,
reproduction steps and suggested mitigation. Until a dedicated security contact
is published, use GitHub private vulnerability reporting if enabled or contact
the maintainer directly. Do not include project credentials or private assets in
reports.

## Security boundaries

Editor and runtime listeners bind to `127.0.0.1` and authenticate requests with a
random, project-local token. The credential is stored under
`.godot/godot_universal_mcp/token`; keep the cache private and out of version
control. Unix token directories/files are restricted to their owner during
creation. Windows relies on the project directory's existing access controls.
The optional `GODOT_MCP_TOKEN` override must be configured in both process
environments and must not be committed to project settings.

The Node MCP server defaults to read-only and checks `security.allowWrite` and
`security.trustMode` for all registered write/destructive tools. MCP annotations
are only client hints. **Possession of the raw bridge token grants private bridge
access independently of the Node server's read-only setting.** This is not a
sandbox against other processes running under the same user account.

Runtime inspection is explicitly opt-in and is limited to development runs with
an editor binary, not normal release or debug export templates. Disabling the
runtime checkbox takes effect on the next game run. Keep the export guards.

Only use trusted projects. Project launch executes project code. Even property
inspection and assignment can invoke script-defined getters/setters; editor
scripts may already execute when a project is opened. No general-purpose eval
operation is provided by the rewritten bridges. Local authentication is not
permission to expose these ports remotely or deploy them in a multi-tenant
service.

TCP frame, queue, client and traversal limits reduce accidental resource
exhaustion; they are not a complete defense against hostile project code.
Timeouts do not guarantee an operation was cancelled. Mutations are not
replayed automatically; inspect state before retrying an uncertain operation.

## Remaining assurance work

Dedicated export-template tests, GUI Undo/Redo and rendered screenshot tests,
Windows engine tests, dependency vulnerability remediation and a broader
security review remain separate work. Review the exact revision's CI results
and dependency audit before distributing a release. See
[the bridge guide](docs/BRIDGE_GUIDE.md) for migration and known limitations.
