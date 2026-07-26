@tool
extends Node

## Editor bridge - listens on localhost TCP port for MCP server connections

const DEFAULT_PORT := 9500
const BUFFER_SIZE := 1024 * 1024  # 1MB

var _server: TCPServer = null
var _clients: Array[StreamPeerTCP] = []
var _port: int = DEFAULT_PORT
var _read_buffers: Dictionary = {}

func _ready() -> void:
	_port = ProjectSettings.get_setting("godot_universal_mcp/editor_port", DEFAULT_PORT)
	_start_server()

func _exit_tree() -> void:
	_stop_server()

func _start_server() -> void:
	_server = TCPServer.new()
	var err := _server.listen(_port, "127.0.0.1")
	if err != OK:
		push_error("[GodotUniversalMCP] Failed to start editor bridge on port %d: %d" % [_port, err])
		return
	print("[GodotUniversalMCP] Editor bridge listening on 127.0.0.1:%d" % _port)

func _stop_server() -> void:
	for client in _clients:
		client.disconnect_from_host()
	_clients.clear()
	_read_buffers.clear()
	if _server != null:
		_server.stop()
		_server = null

func _process(_delta: float) -> void:
	if _server == null:
		return
	# Accept new connections
	while _server.is_connection_available():
		var client := _server.take_connection()
		_clients.append(client)
		_read_buffers[client.get_instance_id()] = PackedByteArray()
		print("[GodotUniversalMCP] New MCP client connected")
	
	# Process existing clients
	var to_remove: Array[StreamPeerTCP] = []
	for client in _clients:
		if client.get_status() == StreamPeerTCP.STATUS_CONNECTED:
			_receive_from_client(client)
		elif client.get_status() == StreamPeerTCP.STATUS_NONE or \
			 client.get_status() == StreamPeerTCP.STATUS_ERROR:
			to_remove.append(client)
	
	for client in to_remove:
		_read_buffers.erase(client.get_instance_id())
		_clients.erase(client)
		print("[GodotUniversalMCP] MCP client disconnected")

func _receive_from_client(client: StreamPeerTCP) -> void:
	var available := client.get_available_bytes()
	if available <= 0:
		return
	
	var data := client.get_data(available)
	if data[0] != OK:
		return
	
	var buf_id := client.get_instance_id()
	if not _read_buffers.has(buf_id):
		_read_buffers[buf_id] = PackedByteArray()
	
	var buffer: PackedByteArray = _read_buffers[buf_id]
	buffer.append_array(data[1])
	_read_buffers[buf_id] = buffer
	
	# Process complete newline-delimited JSON messages
	while true:
		var newline_idx := buffer.find(10)  # \n
		if newline_idx == -1:
			break
		var line_bytes := buffer.slice(0, newline_idx)
		buffer = buffer.slice(newline_idx + 1)
		_read_buffers[buf_id] = buffer
		
		var line := line_bytes.get_string_from_utf8().strip_edges()
		if line.length() == 0:
			continue
		
		var msg := JSON.parse_string(line)
		if msg == null:
			push_warning("[GodotUniversalMCP] Failed to parse JSON: " + line.left(100))
			continue
		
		var response := _handle_request(msg)
		var response_str := JSON.stringify(response) + "\n"
		client.put_data(response_str.to_utf8_buffer())

func _handle_request(msg: Dictionary) -> Dictionary:
	var id: String = msg.get("id", "")
	var tool: String = msg.get("tool", "")
	var params: Dictionary = msg.get("params", {})
	
	var result := _dispatch_tool(tool, params)
	
	return {
		"id": id,
		"type": "response",
		"ok": result.get("ok", true),
		"result": result.get("result", null),
		"error": result.get("error", null),
	}

func _dispatch_tool(tool: String, params: Dictionary) -> Dictionary:
	match tool:
		"editor.get_status":
			return _tool_editor_status()
		"editor.get_scene_tree":
			return _tool_get_scene_tree(params)
		"editor.get_node":
			return _tool_get_node(params)
		"editor.set_node_property":
			return _tool_set_node_property(params)
		"editor.get_output":
			return _tool_get_output()
		"editor.save_all":
			return _tool_save_all()
		"editor.open_scene":
			return _tool_open_scene(params)
		"editor.filesystem_scan":
			return _tool_filesystem_scan()
		"editor.run_project":
			return _tool_run_project(params)
		"editor.stop_project":
			return _tool_stop_project()
		_:
			return {
				"ok": false,
				"result": null,
				"error": {"code": "TOOL_NOT_AVAILABLE", "message": "Unknown tool: " + tool, "details": {}}
			}

func _tool_editor_status() -> Dictionary:
	return {
		"ok": true,
		"result": {
			"connected": true,
			"editorVersion": Engine.get_version_info(),
			"projectPath": ProjectSettings.globalize_path("res://"),
			"projectName": ProjectSettings.get_setting("application/config/name", ""),
			"openScenes": _get_open_scenes(),
		}
	}

func _get_open_scenes() -> Array:
	var result: Array = []
	var ei := EditorInterface.get_open_scenes() if Engine.is_editor_hint() else []
	for s in ei:
		result.append(s)
	return result

func _tool_get_scene_tree(params: Dictionary) -> Dictionary:
	var scene_path: String = params.get("scene_path", "")
	if scene_path.is_empty():
		# Return currently edited scene tree
		if not Engine.is_editor_hint():
			return _err("TOOL_NOT_AVAILABLE", "Not running in editor")
		var edited := EditorInterface.get_edited_scene_root()
		if edited == null:
			return _err("TOOL_NOT_AVAILABLE", "No scene open in editor")
		return {"ok": true, "result": _node_to_dict(edited)}
	else:
		# Load and return scene tree from file
		var scene = load(scene_path)
		if scene == null:
			return _err("INVALID_PROJECT", "Could not load scene: " + scene_path)
		var instance = scene.instantiate()
		var result := _node_to_dict(instance)
		instance.free()
		return {"ok": true, "result": result}

func _node_to_dict(node: Node) -> Dictionary:
	var children: Array = []
	for child in node.get_children():
		children.append(_node_to_dict(child))
	return {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path()),
		"groups": node.get_groups(),
		"children": children,
	}

func _tool_get_node(params: Dictionary) -> Dictionary:
	var scene_path: String = params.get("scene_path", "")
	var node_path: String = params.get("node_path", "")
	
	if not Engine.is_editor_hint():
		return _err("TOOL_NOT_AVAILABLE", "Not running in editor")
	
	var root: Node = null
	if scene_path.is_empty():
		root = EditorInterface.get_edited_scene_root()
	else:
		var scene = load(scene_path)
		if scene == null:
			return _err("INVALID_PROJECT", "Could not load scene: " + scene_path)
		root = scene.instantiate()
	
	if root == null:
		return _err("TOOL_NOT_AVAILABLE", "No scene available")
	
	var node := root.get_node_or_null(node_path)
	if node == null:
		return _err("INVALID_PROJECT", "Node not found: " + node_path)
	
	var props: Dictionary = {}
	var script = node.get_script()
	
	return {
		"ok": true,
		"result": {
			"name": node.name,
			"type": node.get_class(),
			"path": str(node.get_path()),
			"groups": node.get_groups(),
			"hasScript": script != null,
			"scriptPath": script.resource_path if script != null else "",
		}
	}

func _tool_set_node_property(params: Dictionary) -> Dictionary:
	if not Engine.is_editor_hint():
		return _err("TOOL_NOT_AVAILABLE", "Not running in editor")
	
	var node_path: String = params.get("node_path", "")
	var property: String = params.get("property", "")
	var value = params.get("value", null)
	
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return _err("TOOL_NOT_AVAILABLE", "No scene open")
	
	var node := root.get_node_or_null(node_path)
	if node == null:
		return _err("INVALID_PROJECT", "Node not found: " + node_path)
	
	# Use set() directly since we're not in an EditorPlugin context
	node.set(property, value)
	return {"ok": true, "result": {"node": node_path, "property": property, "value": value}}

func _tool_get_output() -> Dictionary:
	# Editor output is not directly accessible via GDScript API
	# Return what we can
	return {
		"ok": true,
		"result": {
			"message": "Editor output capture requires Godot 4.3+ with EditorInterface.get_editor_main_screen()",
			"logs": []
		}
	}

func _tool_save_all() -> Dictionary:
	if not Engine.is_editor_hint():
		return _err("TOOL_NOT_AVAILABLE", "Not running in editor")
	EditorInterface.save_all_scenes()
	return {"ok": true, "result": {"saved": true}}

func _tool_open_scene(params: Dictionary) -> Dictionary:
	if not Engine.is_editor_hint():
		return _err("TOOL_NOT_AVAILABLE", "Not running in editor")
	var scene_path: String = params.get("scene_path", "")
	if scene_path.is_empty():
		return _err("VALIDATION_ERROR", "scene_path is required")
	EditorInterface.open_scene_from_path(scene_path)
	return {"ok": true, "result": {"opened": scene_path}}

func _tool_filesystem_scan() -> Dictionary:
	if not Engine.is_editor_hint():
		return _err("TOOL_NOT_AVAILABLE", "Not running in editor")
	EditorInterface.get_resource_filesystem().scan()
	return {"ok": true, "result": {"scanning": true}}

func _tool_run_project(params: Dictionary) -> Dictionary:
	if not Engine.is_editor_hint():
		return _err("TOOL_NOT_AVAILABLE", "Not running in editor")
	EditorInterface.play_main_scene()
	return {"ok": true, "result": {"running": true}}

func _tool_stop_project() -> Dictionary:
	if not Engine.is_editor_hint():
		return _err("TOOL_NOT_AVAILABLE", "Not running in editor")
	EditorInterface.stop_playing_scene()
	return {"ok": true, "result": {"stopped": true}}

func _err(code: String, message: String) -> Dictionary:
	return {
		"ok": false,
		"result": null,
		"error": {"code": code, "message": message, "details": {}}
	}
