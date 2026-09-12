# Godot plugin

The addon is GDScript and uses native EditorInterface and EditorUndoRedoManager APIs. Follow the [installation guide](../README.md) and [bridge contract](BRIDGE_GUIDE.md).

The plugin is the sole owner of its optional runtime autoload. It restores configured state on reload, refuses to replace another script using its autoload name, and removes its own entry on explicit disable. Existing game processes must be stopped/restarted for runtime setting changes.

Property writes are opt-in and separate from saving. Runtime input is opt-in and constrained to the project's explicit InputMap allowlist. Snapshot providers are optional project code; there are no built-in game-specific player or save services.
