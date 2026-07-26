# Security Policy

## Supported versions

This project is pre-1.0. Security fixes are applied on the default supported branch for the latest release line.

## Reporting a vulnerability

Please do not open public GitHub issues for suspected security vulnerabilities.

Instead, report issues privately to the maintainers with:

- A description of the issue.
- Impact and affected surfaces.
- Reproduction steps or a proof of concept.
- Suggested mitigation if known.

Until a dedicated security contact is published, use GitHub private vulnerability reporting if enabled for the repository or contact the maintainer directly.

## Security boundaries

Godot Universal MCP intentionally exposes powerful project inspection and automation features. To reduce risk:

- Editor and runtime bridges bind to `127.0.0.1` by default.
- Runtime inspection is intended for debug/editor usage only.
- Potentially dangerous capabilities such as eval or remote access should remain disabled unless explicitly needed.
- Users are responsible for controlling which AI clients can connect to the local MCP server.
