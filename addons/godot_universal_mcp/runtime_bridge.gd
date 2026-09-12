extends Node

const Transport = preload("res://addons/godot_universal_mcp/bridge_transport.gd")
const Codec = preload("res://addons/godot_universal_mcp/value_codec.gd")
const Catalog = preload("res://addons/godot_universal_mcp/tool_catalog.gd")
const Extensions = preload("res://addons/godot_universal_mcp/runtime_extensions.gd")
const Capture = preload("res://addons/godot_universal_mcp/frame_capture.gd")
var _transport := Transport.new()
var _catalog := Catalog.new()
var _extensions := Extensions.new()
var _capture := Capture.new()
var _session_id := ""

func _ready() -> void:
	if Engine.is_editor_hint() or not OS.is_debug_build() or not OS.has_feature("editor"):
		return
	if not ProjectSettings.get_setting("godot_universal_mcp/runtime_enabled", false):
		return
	_session_id = Crypto.new().generate_random_bytes(16).hex_encode()
	process_mode = Node.PROCESS_MODE_ALWAYS
	var port := int(ProjectSettings.get_setting("godot_universal_mcp/runtime_port", 9501))
	var err := _transport.start(port, _dispatch_tool, Transport.read_token())
	if err != OK:
		push_error("[GodotUniversalMCP Runtime] " + _transport.last_error)
		return
	_capture.start(self, _identity)

func _exit_tree() -> void:
	_extensions.release_all()
	_capture.stop()
	_transport.stop()

func _process(_delta: float) -> void:
	_extensions.tick()
	_transport.poll()

func _identity() -> Dictionary:
	return {"protocolVersion": 1, "sessionId": _session_id, "processId": OS.get_process_id(),
		"projectPath": ProjectSettings.globalize_path("res://"),
		"projectName": ProjectSettings.get_setting("application/config/name", "")}

func _status() -> Dictionary:
	var scene := get_tree().current_scene
	var result := _identity()
	result.merge({"connected": true, "fps": Engine.get_frames_per_second(),
		"frameCount": Engine.get_process_frames(), "renderedFrames": _capture.rendered_frames,
		"lastRenderedScene": _capture.last_scene, "paused": get_tree().paused,
		"currentScene": scene.scene_file_path if scene else "", "ready": scene != null and scene.is_node_ready(),
		"renderingAvailable": DisplayServer.get_name() != "headless", "uptimeMs": Time.get_ticks_msec()})
	return result

func _dispatch_tool(tool: String, params: Dictionary) -> Dictionary:
	if not tool in _catalog.commands("runtime"):
		return _err("TOOL_NOT_AVAILABLE", "Unknown runtime command: " + tool)
	var validation := _catalog.validate(tool, params)
	if not validation.is_empty():
		return _err("VALIDATION_ERROR", validation)
	match tool:
		"runtime.get_capabilities":
			return _ok({"protocolVersion": 1, "addonLanguage": "GDScript", "requiresDotNet": false,
				"csharpAvailable": ClassDB.class_exists("CSharpScript"), "tools": _catalog.commands("runtime"),
				"logCapture": false, "nodePaths": "relative to /root; . means root", "maxTreeNodes": 512,
				"snapshotProvidersEnabled": ProjectSettings.get_setting("godot_universal_mcp/allow_snapshot_providers", false),
				"inputEnabled": ProjectSettings.get_setting("godot_universal_mcp/allow_runtime_input", false),
				"propertyWritesEnabled": ProjectSettings.get_setting("godot_universal_mcp/allow_runtime_property_writes", false)})
		"runtime.get_status":
			return _ok(_status())
		"runtime.get_tree":
			if params.has("scene_path") and (get_tree().current_scene == null or params.scene_path != get_tree().current_scene.scene_file_path):
				return _err("INVALID_PROJECT", "Current scene does not match scene_path")
			var node_path: Variant = params.get("node_path", ".")
			if not Codec.valid_node_path(node_path):
				return _err("VALIDATION_ERROR", "Invalid relative node path")
			var node := get_tree().root.get_node_or_null(NodePath(node_path))
			if node == null:
				return _err("INVALID_PROJECT", "Node not found")
			return _ok(Codec.tree(node, get_tree().root, int(params.get("max_depth", 4)), {"remaining": int(params.get("max_nodes", 512))}))
		"runtime.get_node", "runtime.get_property", "runtime.set_property":
			return _node_tool(tool, params)
		"runtime.get_logs":
			return _err("NOT_IMPLEMENTED", "Live bridge logging is unsupported on this baseline; managed-process logs are a separate source")
		"runtime.get_perf":
			return _ok({"fps": Engine.get_frames_per_second(), "processSeconds": Performance.get_monitor(Performance.TIME_PROCESS),
				"physicsSeconds": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS),
				"staticMemory": OS.get_static_memory_usage(), "staticMemoryPeak": OS.get_static_memory_peak_usage()})
		"runtime.pause":
			get_tree().paused = true
			return _ok({"paused": true})
		"runtime.resume":
			get_tree().paused = false
			return _ok({"paused": false})
		"runtime.screenshot":
			return _capture.capture(int(params.get("max_edge", 1024)))
		"runtime.get_snapshot":
			return _extensions.snapshot(get_tree(), _status())
		"runtime.get_input_actions":
			return _extensions.input_actions()
		"runtime.send_action":
			return _extensions.send_action(params)
	return _err("TOOL_NOT_AVAILABLE", "Handler is missing for " + tool)

func _node_tool(tool: String, params: Dictionary) -> Dictionary:
	if not Codec.valid_node_path(params.node_path):
		return _err("VALIDATION_ERROR", "Use a /root-relative node path without parent traversal")
	var node := get_tree().root.get_node_or_null(NodePath(params.node_path))
	if node == null:
		return _err("INVALID_PROJECT", "Node not found")
	if tool == "runtime.get_node":
		return _ok(Codec.node_info(node, get_tree().root, true))
	var property: String = params.property
	if property in ["script", "owner", "scene_file_path"]:
		return _err("VALIDATION_ERROR", "Unsupported property")
	var info := Codec.property_info(node, property)
	if info.is_empty():
		return _err("VALIDATION_ERROR", "Unknown property")
	if tool == "runtime.get_property":
		return _ok({"property": property, "value": Codec.encode(node.get(property))})
	if not ProjectSettings.get_setting("godot_universal_mcp/allow_runtime_property_writes", false):
		return _err("WRITE_DISABLED", "Enable allow_runtime_property_writes explicitly in trusted development projects")
	if (int(info.usage) & PROPERTY_USAGE_READ_ONLY) != 0:
		return _err("VALIDATION_ERROR", "Read-only property")
	var decoded := Codec.decode(params.value, info)
	if not decoded.ok:
		return _err("VALIDATION_ERROR", decoded.message)
	node.set(property, decoded.value)
	return _ok({"property": property, "value": Codec.encode(node.get(property)), "saved": false})

func _ok(value: Variant) -> Dictionary:
	return {"ok": true, "result": value}

func _err(code: String, message: String) -> Dictionary:
	return Transport._error(code, message)
