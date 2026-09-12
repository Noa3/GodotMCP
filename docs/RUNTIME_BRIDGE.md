# Runtime bridge

See [BRIDGE_GUIDE.md](BRIDGE_GUIDE.md) for the canonical runtime contract and [TOOL_REFERENCE.md](TOOL_REFERENCE.md) for actual public names.

Runtime starts only after opt-in through the plugin, in an editor binary running the game. Export templates do not open a bridge. Readiness is distinct from launch acknowledgement; use `godot_runtime_wait_ready` or the default waiting behavior of `godot_editor_run_project`.

Live bridge log capture is not implemented on this baseline. Managed-process logs are a distinct source. An ordinary project launch is not an isolated validation run.
