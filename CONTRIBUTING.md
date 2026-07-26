# Contributing

Thanks for your interest in improving Godot Universal MCP.

## Before you start

- Open an issue for significant features or breaking changes.
- Keep pull requests focused and easy to review.
- Read `SECURITY.md` before reporting vulnerabilities.

## Development workflow

1. Fork the repository and create a feature branch.
2. Make surgical changes with tests or validation updates when relevant.
3. Run the existing quality checks:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run build`
4. Update docs when behavior, setup, or public interfaces change.
5. Submit a pull request with a clear summary and validation notes.

## Coding guidelines

- Preserve compatibility with the repository's supported Node.js and Godot versions.
- Prefer clear tool contracts and stable JSON response shapes.
- Keep security-sensitive behavior opt-in and documented.
- Avoid unrelated refactors in the same change set.

## Documentation expectations

User-facing changes should update the root `README.md` and any relevant files under `docs/`.
Addon changes should also update `addons/godot_universal_mcp/README.md` when installation or usage changes.

## Pull request checklist

- [ ] Scope is focused.
- [ ] Existing commands still work.
- [ ] Docs are updated if needed.
- [ ] No secrets or local credentials were committed.
