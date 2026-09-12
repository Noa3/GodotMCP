@tool
extends Node

const Transport = preload("res://addons/godot_universal_mcp/bridge_transport.gd")
const Codec = preload("res://addons/godot_universal_mcp/value_codec.gd")
const TOOLS := ["editor.get_status", "editor.get_capabilities", "editor.get_scene_tree", "editor.get_node", "editor.set_node_property", "editor.get_output", "editor.save_all", "editor.open_scene", "editor.filesystem_scan", "editor.run_project", "editor.stop_project"]
var undo_redo: EditorUndoRedoManager
var _transport := Transport.new()
var _port := 9500

func _ready() -> void:
	if not Engine.is_editor_hint():
		return
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
	return {
		"protocolVersion": 1, "addonLanguage": "GDScript", "requiresDotNet": false,
		"csharpAvailable": ClassDB.class_exists("CSharpScript"), "tools": TOOLS,
		"undoRedo": undo_redo != null, "outputCapture": false,
		"authentication": "project-token", "nodePaths": "relative to edited scene root; use . for root",
		"maxTreeNodes": 512, "maxTreeDepth": 12,
	}

func _dispatch_tool(tool: String, params: Dictionary) -> Dictionary:
	if not Engine.is_editor_hint():
		return _err("TOOL_NOT_AVAILABLE", "Editor bridge only runs in the editor")
	match tool:
		"editor.get_status":
			return _ok({"connected": true, "editorVersion": Engine.get_version_info(), "projectPath": ProjectSettings.globalize_path("res://"), "projectName": ProjectSettings.get_setting("application/config/name", ""), "openScenes": Array(EditorInterface.get_open_scenes()), "capabilities": _capabilities()})
		"editor.get_capabilities":
			return _ok(_capabilities())
		"editor.get_scene_tree", "editor.get_node", "editor.set_node_property":
			return _scene_tool(tool, params)
		"editor.get_output":
			return _err("NOT_IMPLEMENTED", "Editor output capture is not implemented; an empty log is not evidence of no errors")
		"editor.save_all":
			EditorInterface.save_all_scenes()
			return _ok({"requested": true})
		"editor.open_scene":
			var scene_path: Variant = params.get("scene_path")
			if not (scene_path is String) or not scene_path.begins_with("res://") or not scene_path.ends_with(".tscn") or ".." in scene_path.split("/") or "\\" in scene_path:
				return _err("VALIDATION_ERROR", "Expected a project-local res:// scene path")
			if not FileAccess.file_exists(scene_path):
				return _err("INVALID_PROJECT", "Scene file does not exist")
			EditorInterface.open_scene_from_path(scene_path)
			return _ok({"requested": scene_path})
		"editor.filesystem_scan":
			EditorInterface.get_resource_filesystem().scan()
			return _ok({"scanning": true})
		"editor.run_project":
			EditorInterface.play_main_scene()
			return _ok({"requested": true})
		"editor.stop_project":
			EditorInterface.stop_playing_scene()
			return _ok({"requested": true})
	return _err("TOOL_NOT_AVAILABLE", "Unknown editor tool: " + tool)

func _scene_tool(tool: String, params: Dictionary) -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return _err("TOOL_NOT_AVAILABLE", "No scene open in editor")
	var scene_path: Variant = params.get("scene_path", "")
	if not (scene_path is String):
		return _err("VALIDATION_ERROR", "scene_path must be a string")
	if not scene_path.is_empty() and scene_path != root.scene_file_path:
		return _err("TOOL_NOT_AVAILABLE", "Only the currently edited scene is inspected; open the scene first or use offline scene tools")
	if tool == "editor.get_scene_tree":
		var depth: Variant = params.get("max_depth", 4)
		if not (depth is int or depth is float) or depth < 0 or depth > 12 or floor(float(depth)) != float(depth):
			return _err("VALIDATION_ERROR", "max_depth must be an integer between 0 and 12")
		return _ok(Codec.tree(root, root, int(depth), {"remaining": 512}))
	var node_path: Variant = params.get("node_path")
	if not Codec.valid_node_path(node_path):
		return _err("VALIDATION_ERROR", "node_path must be relative to the scene root, without parent traversal")
	var node := root.get_node_or_null(NodePath(node_path))
	if node == null:
		return _err("INVALID_PROJECT", "Node not found: " + str(node_path))
	if tool == "editor.get_node":
		return _ok(Codec.node_info(node, root, true))
	if undo_redo == null:
		return _err("TOOL_NOT_AVAILABLE", "Editor undo manager is unavailable")
	var property: Variant = params.get("property")
	if not (property is String) or property in ["script", "owner"] or not params.has("value"):
		return _err("VALIDATION_ERROR", "A supported property and value are required")
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
	return _ok({"node": node_path, "property": property, "value": Codec.encode(node.get(property))})

func _ok(value: Variant) -> Dictionary:
	return {"ok": true, "result": value}

func _err(code: String, message: String) -> Dictionary:
	return Transport._error(code, message)
