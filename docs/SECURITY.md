# Security Model

## Trust boundaries

- The MCP client is trusted to issue tool requests.
- The TypeScript server validates requests before forwarding them.
- Godot bridges accept only localhost TCP connections by default.

## Recommended defaults

- Keep `allow_remote` disabled.
- Keep `allow_eval` disabled.
- Enable runtime access only for local debug work.
- Do not expose bridge ports on shared or untrusted networks.

## Operational guidance

- Treat runtime mutation tools as development-only features.
- Avoid attaching the runtime bridge to production builds.
- Review editor prompts and AI-generated actions before applying destructive changes.
