extends Node

const Transport = preload("res://addons/godot_universal_mcp/bridge_transport.gd")
const Codec = preload("res://addons/godot_universal_mcp/value_codec.gd")
const TOOLS := ["runtime.get_status", "runtime.get_capabilities", "runtime.get_tree", "runtime.get_node", "runtime.get_property", "runtime.set_property", "runtime.get_logs", "runtime.get_perf", "runtime.pause", "runtime.resume", "runtime.screenshot"]
var _transport := Transport.new()

func _ready() -> void:
	# Neither release exports nor debug exports may open a development control port.
	if Engine.is_editor_hint() or not OS.is_debug_build() or not OS.has_feature("editor"):
		return
	if not ProjectSettings.get_setting("godot_universal_mcp/runtime_enabled", false):
		return
	process_mode = Node.PROCESS_MODE_ALWAYS # Resume must still be serviced while paused.
	var port := int(ProjectSettings.get_setting("godot_universal_mcp/runtime_port", 9501))
	var err := _transport.start(port, _dispatch_tool, Transport.read_token())
	if err != OK:
		push_error("[GodotUniversalMCP Runtime] " + _transport.last_error)

func _exit_tree() -> void:
	_transport.stop()

func _process(_delta: float) -> void:
	_transport.poll()

func _dispatch_tool(tool: String, params: Dictionary) -> Dictionary:
	match tool:
		"runtime.get_capabilities":
			return _ok({"protocolVersion": 1, "addonLanguage": "GDScript", "requiresDotNet": false, "csharpAvailable": ClassDB.class_exists("CSharpScript"), "tools": TOOLS, "logCapture": false, "nodePaths": "relative to /root; use . for root", "maxTreeNodes": 512})
		"runtime.get_status":
			return _ok({"connected": true, "fps": Engine.get_frames_per_second(), "frameCount": Engine.get_process_frames(), "paused": get_tree().paused, "currentScene": get_tree().current_scene.scene_file_path if get_tree().current_scene else ""})
		"runtime.get_tree":
			return _ok(Codec.tree(get_tree().root, get_tree().root, 4, {"remaining": 512}))
		"runtime.get_node", "runtime.get_property", "runtime.set_property":
			return _node_tool(tool, params)
		"runtime.get_logs":
			return _err("NOT_IMPLEMENTED", "Bridge log capture is not implemented; use managed-process logs")
		"runtime.get_perf":
			return _ok({"fps": Engine.get_frames_per_second(), "processSeconds": Performance.get_monitor(Performance.TIME_PROCESS), "physicsSeconds": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS), "staticMemory": OS.get_static_memory_usage(), "staticMemoryPeak": OS.get_static_memory_peak_usage()})
		"runtime.pause":
			get_tree().paused = true
			return _ok({"paused": true})
		"runtime.resume":
			get_tree().paused = false
			return _ok({"paused": false})
		"runtime.screenshot":
			return _screenshot()
	return _err("TOOL_NOT_AVAILABLE", "Unknown runtime tool: " + tool)

func _node_tool(tool: String, params: Dictionary) -> Dictionary:
	var node_path: Variant = params.get("node_path")
	if not Codec.valid_node_path(node_path):
		return _err("VALIDATION_ERROR", "node_path must be relative to /root, without parent traversal")
	var node := get_tree().root.get_node_or_null(NodePath(node_path))
	if node == null:
		return _err("INVALID_PROJECT", "Node not found")
	if tool == "runtime.get_node":
		return _ok(Codec.node_info(node, get_tree().root, true))
	var property: Variant = params.get("property")
	if not (property is String) or property in ["script", "owner"]:
		return _err("VALIDATION_ERROR", "A supported property name is required")
	var info := Codec.property_info(node, property)
	if info.is_empty():
		return _err("VALIDATION_ERROR", "Unknown property")
	if tool == "runtime.get_property":
		return _ok({"property": property, "value": Codec.encode(node.get(property))})
	if not params.has("value") or (int(info.usage) & PROPERTY_USAGE_READ_ONLY) != 0:
		return _err("VALIDATION_ERROR", "Missing value or read-only property")
	var decoded := Codec.decode(params.value, info)
	if not decoded.ok:
		return _err("VALIDATION_ERROR", decoded.message)
	node.set(property, decoded.value)
	return _ok({"property": property, "value": Codec.encode(node.get(property))})

func _screenshot() -> Dictionary:
	if DisplayServer.get_name() == "headless":
		return _err("TOOL_NOT_AVAILABLE", "Screenshots require a rendering display")
	var texture := get_viewport().get_texture()
	if texture == null:
		return _err("TOOL_NOT_AVAILABLE", "Viewport texture is unavailable")
	var image := texture.get_image()
	if image == null or image.is_empty():
		return _err("TOOL_NOT_AVAILABLE", "No rendered frame is available")
	var scale := minf(1.0, 1024.0 / maxf(image.get_width(), image.get_height()))
	if scale < 1.0:
		image.resize(maxi(1, int(image.get_width() * scale)), maxi(1, int(image.get_height() * scale)))
	return _ok({"format": "png", "base64": Marshalls.raw_to_base64(image.save_png_to_buffer()), "width": image.get_width(), "height": image.get_height()})

func _ok(value: Variant) -> Dictionary:
	return {"ok": true, "result": value}

func _err(code: String, message: String) -> Dictionary:
	return Transport._error(code, message)
