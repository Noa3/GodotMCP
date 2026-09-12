# Roadmap

## Implemented foundation; verify exact commit through CI

- GDScript addon plus local TypeScript MCP adapter; no game-specific paths.
- Correct plugin manifest, authenticated bounded transport, centralized write authorization and stderr-only server logging.
- Local installation/configuration generation; non-destructive merging of unrelated client entries; one plugin-owned runtime lifecycle.
- Shared bridge/workflow manifest, strict schemas, generated tool reference and drift tests.
- Project/session identity, bounded runtime readiness and start/stop verification; no automatic mutation replay.
- Native MCP PNG content with render-frame/camera provenance and hash.
- Optional semantic snapshot providers and allowlisted InputMap actions with press leases.
- Standard/.NET headless fixtures and rendered MCP end-to-end fixture, plus installation tests on Linux/Windows.

## Next reliability work

1. Remediate dependency audit findings and review inherited offline path/file tools and trust configuration surfaces.
2. Version-gated thread-safe Godot Logger capture and compiler/debugger diagnostics, with explicit source/support indicators.
3. Automatic local endpoint discovery and explicit multi-instance selection; port conflict diagnostics and session-bound writes.
4. Isolated named-check validation service with temporary workspaces/user profiles, bounded execution and real evidence/artifacts; no arbitrary shell strings.
5. Additional Godot versions, native Windows engine tests, export-template checks, GUI undo/redo and scene reload tests.

## Later

- Native transactional scene/resource operations with previews, diffs and rollback.
- Deterministic action sequence recording/replay with outcome assertions.
- Explicit viewport/camera capture selection and controlled baseline comparisons.
- Opt-in project-specific diagnostic actions with typed contracts, not generic eval or reflection.

A passed fixture is not a claim of complete compatibility or universal gameplay understanding. Add evidence before marking these future capabilities implemented.
