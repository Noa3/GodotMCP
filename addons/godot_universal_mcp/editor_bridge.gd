@tool
extends Node

const Transport = preload("res://addons/godot_universal_mcp/bridge_transport.gd")
const Codec = preload("res://addons/godot_universal_mcp/value_codec.gd")
const Catalog = preload("res://addons/godot_universal_mcp/tool_catalog.gd")
var undo_redo: EditorUndoRedoManager
var _transport := Transport.new()
var _catalog := Catalog.new()
var _port := 9500
var _session_id := ""

func _ready() -> void:
	if not Engine.is_editor_hint():
		return
	_session_id = Crypto.new().generate_random_bytes(16).hex_encode()
	_port = int(ProjectSettings.get_setting("godot_universal_mcp/editor_port", 9500))
	var err := _transport.start(_port, _dispatch_tool, Transport.read_token(true))
	if err != OK:
		push_error("[GodotUniversalMCP] " + _transport.last_error)

func _exit_tree() -> void:
	_transport.stop()

func _process(_delta: float) -> void:
	_transport.poll()

func connection_status() -> Dictionary:
	return {"listening": _transport.is_listening(), "port": _port, "error": _transport.last_error}

func _capabilities() -> Dictionary:
	return {"protocolVersion": 1, "addonLanguage": "GDScript", "requiresDotNet": false,
		"csharpAvailable": ClassDB.class_exists("CSharpScript"), "tools": _catalog.commands("editor"),
		"undoRedo": undo_redo != null, "outputCapture": false,
		"propertyWritesEnabled": ProjectSettings.get_setting("godot_universal_mcp/allow_editor_property_writes", false),
		"authentication": "project-token", "nodePaths": "relative to edited scene root; . means root",
		"maxTreeNodes": 512, "maxTreeDepth": 12}

func _status() -> Dictionary:
	return {"protocolVersion": 1, "sessionId": _session_id, "processId": OS.get_process_id(),
		"connected": true, "editorVersion": Engine.get_version_info(),
		"projectPath": ProjectSettings.globalize_path("res://"),
		"projectName": ProjectSettings.get_setting("application/config/name", ""),
		"mainScene": ProjectSettings.get_setting("application/run/main_scene", ""),
		"isPlaying": EditorInterface.is_playing_scene(), "playingScene": EditorInterface.get_playing_scene(),
		"scanning": EditorInterface.get_resource_filesystem().is_scanning(),
		"runtimeEnabled": ProjectSettings.get_setting("godot_universal_mcp/runtime_enabled", false),
		"openScenes": Array(EditorInterface.get_open_scenes()), "capabilities": _capabilities()}

func _dispatch_tool(tool: String, params: Dictionary) -> Dictionary:
	if not Engine.is_editor_hint():
		return _err("TOOL_NOT_AVAILABLE", "Editor bridge only runs in the editor")
	if not tool in _catalog.commands("editor"):
		return _err("TOOL_NOT_AVAILABLE", "Unknown editor command: " + tool)
	var validation := _catalog.validate(tool, params)
	if not validation.is_empty():
		return _err("VALIDATION_ERROR", validation)
	match tool:
		"editor.get_status":
			return _ok(_status())
		"editor.get_capabilities":
			return _ok(_capabilities())
		"editor.get_scene_tree", "editor.get_node", "editor.set_node_property":
			return _scene_tool(tool, params)
		"editor.get_output":
			return _err("NOT_IMPLEMENTED", "Live editor log capture is unsupported on this baseline; an empty log would not prove absence of errors")
		"editor.save_all":
			EditorInterface.save_all_scenes()
			return _ok({"requested": true})
		"editor.open_scene":
			var scene_path: String = params.scene_path
			if not scene_path.begins_with("res://") or not scene_path.ends_with(".tscn") or ".." in scene_path.split("/") or "\\" in scene_path:
				return _err("VALIDATION_ERROR", "Expected a project-local res:// .tscn path")
			if not FileAccess.file_exists(scene_path):
				return _err("INVALID_PROJECT", "Scene file does not exist")
			EditorInterface.open_scene_from_path(scene_path)
			return _ok({"requested": scene_path})
		"editor.filesystem_scan":
			EditorInterface.get_resource_filesystem().scan()
			return _ok({"requested": true, "scanning": true})
		"editor.run_project":
			if str(ProjectSettings.get_setting("application/run/main_scene", "")).is_empty():
				return _err("INVALID_PROJECT", "Configure application/run/main_scene before starting")
			EditorInterface.play_main_scene()
			return _ok({"requested": true, "ready": false})
		"editor.stop_project":
			EditorInterface.stop_playing_scene()
			return _ok({"requested": true})
	return _err("TOOL_NOT_AVAILABLE", "Handler is missing for " + tool)

func _scene_tool(tool: String, params: Dictionary) -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return _err("TOOL_NOT_AVAILABLE", "No scene open in editor")
	if params.has("scene_path") and params.scene_path != root.scene_file_path:
		return _err("TOOL_NOT_AVAILABLE", "Only the currently edited scene is inspected; open the requested scene first")
	var node_path: Variant = params.get("node_path", ".")
	if not Codec.valid_node_path(node_path):
		return _err("VALIDATION_ERROR", "Use a relative node path without parent traversal")
	var node := root.get_node_or_null(NodePath(node_path))
	if node == null:
		return _err("INVALID_PROJECT", "Node not found")
	if tool == "editor.get_scene_tree":
		return _ok(Codec.tree(node, root, int(params.get("max_depth", 4)), {"remaining": int(params.get("max_nodes", 512))}))
	if tool == "editor.get_node":
		return _ok(Codec.node_info(node, root, true))
	if not ProjectSettings.get_setting("godot_universal_mcp/allow_editor_property_writes", false):
		return _err("WRITE_DISABLED", "Enable allow_editor_property_writes explicitly in trusted development projects")
	if undo_redo == null:
		return _err("TOOL_NOT_AVAILABLE", "Editor undo manager is unavailable")
	var property: String = params.property
	if property in ["script", "owner", "scene_file_path"]:
		return _err("VALIDATION_ERROR", "This property cannot be assigned through the bridge")
	var info := Codec.property_info(node, property)
	if info.is_empty() or (int(info.usage) & PROPERTY_USAGE_READ_ONLY) != 0:
		return _err("VALIDATION_ERROR", "Unknown or read-only property")
	var decoded := Codec.decode(params.value, info)
	if not decoded.ok:
		return _err("VALIDATION_ERROR", decoded.message)
	undo_redo.create_action("MCP: Set " + property, UndoRedo.MERGE_DISABLE, node)
	undo_redo.add_do_property(node, property, decoded.value)
	undo_redo.add_undo_property(node, property, node.get(property))
	undo_redo.commit_action()
	return _ok({"node": str(root.get_path_to(node)), "property": property, "value": Codec.encode(node.get(property)), "saved": false})

func _ok(value: Variant) -> Dictionary:
	return {"ok": true, "result": value}

func _err(code: String, message: String) -> Dictionary:
	return Transport._error(code, message)
