# Linux installation

Follow the [canonical local installation](../README.md#one-supported-installation-route). Use `node dist/cli/index.js install "/absolute/path/to/game" --enable` after `npm ci` and `npm run build` in the server checkout. Close Godot before installation or upgrade.

The installer resolves the local Node executable and adapter path, preserves other MCP entries, and produces the same configuration that the Godot dock copies. No npm registry publication or game-specific script is assumed. Reinstall after moving the checkout or game. Runtime opt-in is managed by the plugin, not a second manual autoload.
