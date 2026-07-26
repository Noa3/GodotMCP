extends Node

## Runtime bridge autoload - provides game state inspection during gameplay
## Only active in debug/editor builds

const DEFAULT_PORT := 9501
const BUFFER_SIZE := 1024 * 1024

var _server: TCPServer = null
var _clients: Array[StreamPeerTCP] = []
var _read_buffers: Dictionary = {}
var _port: int = DEFAULT_PORT
var _enabled := false

func _ready() -> void:
	# Only enable in debug/editor builds
	if not (OS.is_debug_build() or Engine.is_editor_hint()):
		return
	
	if not ProjectSettings.get_setting("godot_universal_mcp/runtime_enabled", true):
		return
	
	_enabled = true
	_port = ProjectSettings.get_setting("godot_universal_mcp/runtime_port", DEFAULT_PORT)
	_start_server()

func _exit_tree() -> void:
	_stop_server()

func _start_server() -> void:
	_server = TCPServer.new()
	var err := _server.listen(_port, "127.0.0.1")
	if err != OK:
		push_error("[GodotUniversalMCP Runtime] Failed to start on port %d: %d" % [_port, err])
		return
	print("[GodotUniversalMCP Runtime] Listening on 127.0.0.1:%d" % _port)

func _stop_server() -> void:
	for client in _clients:
		client.disconnect_from_host()
	_clients.clear()
	_read_buffers.clear()
	if _server != null:
		_server.stop()
		_server = null

func _process(_delta: float) -> void:
	if not _enabled or _server == null:
		return
	
	while _server.is_connection_available():
		var client := _server.take_connection()
		_clients.append(client)
		_read_buffers[client.get_instance_id()] = PackedByteArray()
	
	var to_remove: Array[StreamPeerTCP] = []
	for client in _clients:
		if client.get_status() == StreamPeerTCP.STATUS_CONNECTED:
			_receive_from_client(client)
		else:
			to_remove.append(client)
	
	for client in to_remove:
		_read_buffers.erase(client.get_instance_id())
		_clients.erase(client)

func _receive_from_client(client: StreamPeerTCP) -> void:
	var available := client.get_available_bytes()
	if available <= 0:
		return
	
	var data := client.get_data(available)
	if data[0] != OK:
		return
	
	var buf_id := client.get_instance_id()
	var buffer: PackedByteArray = _read_buffers.get(buf_id, PackedByteArray())
	buffer.append_array(data[1])
	_read_buffers[buf_id] = buffer
	
	while true:
		var newline_idx := buffer.find(10)
		if newline_idx == -1:
			break
		var line_bytes := buffer.slice(0, newline_idx)
		buffer = buffer.slice(newline_idx + 1)
		_read_buffers[buf_id] = buffer
		
		var line := line_bytes.get_string_from_utf8().strip_edges()
		if line.is_empty():
			continue
		
		var msg := JSON.parse_string(line)
		if msg == null:
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
		"runtime.get_status":
			return _tool_status()
		"runtime.get_tree":
			return _tool_get_tree()
		"runtime.get_node":
			return _tool_get_node(params)
		"runtime.get_property":
			return _tool_get_property(params)
		"runtime.set_property":
			return _tool_set_property(params)
		"runtime.get_logs":
			return _tool_get_logs()
		"runtime.get_perf":
			return _tool_get_perf()
		"runtime.pause":
			return _tool_pause()
		"runtime.resume":
			return _tool_resume()
		"runtime.screenshot":
			return _tool_screenshot()
		_:
			return _err("TOOL_NOT_AVAILABLE", "Unknown runtime tool: " + tool)

func _tool_status() -> Dictionary:
	return {
		"ok": true,
		"result": {
			"connected": true,
			"fps": Engine.get_frames_per_second(),
			"frameCount": Engine.get_process_frames(),
			"physicsFrames": Engine.get_physics_frames(),
			"timeScale": Engine.time_scale,
			"paused": get_tree().paused,
			"currentScene": get_tree().current_scene.scene_file_path if get_tree().current_scene else "",
		}
	}

func _tool_get_tree() -> Dictionary:
	var root := get_tree().root
	return {"ok": true, "result": _node_to_dict(root, 0, 4)}

func _node_to_dict(node: Node, depth: int, max_depth: int) -> Dictionary:
	var children: Array = []
	if depth < max_depth:
		for child in node.get_children():
			children.append(_node_to_dict(child, depth + 1, max_depth))
	return {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path()),
		"groups": node.get_groups(),
		"childCount": node.get_child_count(),
		"children": children,
	}

func _tool_get_node(params: Dictionary) -> Dictionary:
	var node_path: String = params.get("node_path", "")
	var node := get_tree().root.get_node_or_null(node_path)
	if node == null:
		return _err("INVALID_PROJECT", "Node not found: " + node_path)
	return {
		"ok": true,
		"result": {
			"name": node.name,
			"type": node.get_class(),
			"path": str(node.get_path()),
			"groups": node.get_groups(),
			"visible": node.get("visible") if node.has_method("is_visible") else null,
			"position": _variant_to_json(node.get("position")) if node.get("position") != null else null,
		}
	}

func _tool_get_property(params: Dictionary) -> Dictionary:
	var node_path: String = params.get("node_path", "")
	var property: String = params.get("property", "")
	var node := get_tree().root.get_node_or_null(node_path)
	if node == null:
		return _err("INVALID_PROJECT", "Node not found: " + node_path)
	var value = node.get(property)
	return {"ok": true, "result": {"property": property, "value": _variant_to_json(value)}}

func _tool_set_property(params: Dictionary) -> Dictionary:
	var node_path: String = params.get("node_path", "")
	var property: String = params.get("property", "")
	var value = params.get("value", null)
	var node := get_tree().root.get_node_or_null(node_path)
	if node == null:
		return _err("INVALID_PROJECT", "Node not found: " + node_path)
	node.set(property, value)
	return {"ok": true, "result": {"set": true}}

func _tool_get_logs() -> Dictionary:
	return {"ok": true, "result": {"logs": [], "message": "Log capture requires custom logging setup"}}

func _tool_get_perf() -> Dictionary:
	return {
		"ok": true,
		"result": {
			"fps": Engine.get_frames_per_second(),
			"frameTime": 1.0 / max(Engine.get_frames_per_second(), 1),
			"staticMemory": OS.get_static_memory_usage(),
			"staticMemoryPeak": OS.get_static_memory_peak_usage(),
		}
	}

func _tool_pause() -> Dictionary:
	get_tree().paused = true
	return {"ok": true, "result": {"paused": true}}

func _tool_resume() -> Dictionary:
	get_tree().paused = false
	return {"ok": true, "result": {"paused": false}}

func _tool_screenshot() -> Dictionary:
	# Capture viewport as PNG base64
	var viewport := get_viewport()
	var img := viewport.get_texture().get_image()
	var png_bytes := img.save_png_to_buffer()
	var b64 := Marshalls.raw_to_base64(png_bytes)
	return {"ok": true, "result": {"format": "png", "base64": b64, "width": img.get_width(), "height": img.get_height()}}

func _variant_to_json(value) -> Variant:
	if value == null:
		return null
	if value is Vector2:
		return {"x": value.x, "y": value.y}
	if value is Vector3:
		return {"x": value.x, "y": value.y, "z": value.z}
	if value is Color:
		return {"r": value.r, "g": value.g, "b": value.b, "a": value.a}
	if value is bool or value is int or value is float or value is String:
		return value
	return str(value)

func _err(code: String, message: String) -> Dictionary:
	return {
		"ok": false,
		"result": null,
		"error": {"code": code, "message": message, "details": {}}
	}
