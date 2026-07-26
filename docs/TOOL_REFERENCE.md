# Tool Reference

## Editor tools

| Tool | Purpose |
| --- | --- |
| `editor.get_status` | Returns editor version, project path, project name, and open scenes. |
| `editor.get_scene_tree` | Returns the current edited scene tree or a loaded scene tree from disk. |
| `editor.get_node` | Returns basic metadata for a node in the editor scene context. |
| `editor.set_node_property` | Changes a property using Godot undo/redo support. |
| `editor.get_output` | Returns placeholder editor log information when direct capture is unavailable. |
| `editor.save_all` | Saves all open scenes. |
| `editor.open_scene` | Opens a scene by path. |
| `editor.filesystem_scan` | Triggers a resource filesystem scan. |
| `editor.run_project` | Starts the main scene from the editor. |
| `editor.stop_project` | Stops the currently running scene. |

## Runtime tools

| Tool | Purpose |
| --- | --- |
| `runtime.get_status` | Returns runtime frame and scene status. |
| `runtime.get_tree` | Returns a bounded scene tree snapshot. |
| `runtime.get_node` | Returns metadata about a runtime node. |
| `runtime.get_property` | Reads a runtime node property. |
| `runtime.set_property` | Sets a runtime node property. |
| `runtime.get_logs` | Returns runtime log placeholder information. |
| `runtime.get_perf` | Returns performance counters. |
| `runtime.pause` | Pauses the SceneTree. |
| `runtime.resume` | Resumes the SceneTree. |
| `runtime.screenshot` | Captures the current viewport and returns PNG base64. |
