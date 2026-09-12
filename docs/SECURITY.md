# Security model

See [the repository policy](../SECURITY.md) and [BRIDGE_GUIDE.md](BRIDGE_GUIDE.md#permissions-and-lifecycle).

Loopback plus a random project token protects against accidental/unauthenticated clients, not against another process that can read that token. Raw bridge access is independent of Node read-only settings. Project getters, setters, providers and importers can execute code.

Input requires an explicit InputMap allowlist and bounded press duration. Property writes require separate opt-in and typed conversion. There is no eval tool or arbitrary-shell validation API. Ordinary managed project launch can still use normal game saves and is not isolated testing.

Malformed data, wrong project identity, oversized messages and incompatible protocol versions fail explicitly. Unsupported diagnostics are not empty-success evidence. Dependency audit remediation and a wider security review remain required before a production claim.
