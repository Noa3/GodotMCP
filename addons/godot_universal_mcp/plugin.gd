@tool
extends EditorPlugin

const PLUGIN_NAME = "GodotUniversalMCP"
const AUTOLOAD_NAME = "GodotUniversalMcpRuntime"
const AUTOLOAD_PATH = "res://addons/godot_universal_mcp/runtime_bridge.gd"

var editor_bridge: Node = null
var dock: Control = null
var _autoload_registered := false

func _enter_tree() -> void:
	_register_project_settings()
	_start_editor_bridge()
	_add_dock()

func _exit_tree() -> void:
	_remove_dock()
	_stop_editor_bridge()

func _enable_plugin() -> void:
	print("[GodotUniversalMCP] Plugin enabled")

func _disable_plugin() -> void:
	print("[GodotUniversalMCP] Plugin disabled")
	if _autoload_registered:
		remove_autoload_singleton(AUTOLOAD_NAME)
		_autoload_registered = false

func _register_project_settings() -> void:
	_add_setting("godot_universal_mcp/editor_port", TYPE_INT, 9500)
	_add_setting("godot_universal_mcp/runtime_port", TYPE_INT, 9501)
	_add_setting("godot_universal_mcp/runtime_enabled", TYPE_BOOL, true)
	_add_setting("godot_universal_mcp/allow_runtime_input", TYPE_BOOL, false)
	_add_setting("godot_universal_mcp/allow_eval", TYPE_BOOL, false)
	_add_setting("godot_universal_mcp/allow_remote", TYPE_BOOL, false)
	_add_setting("godot_universal_mcp/log_level", TYPE_STRING, "info")

func _add_setting(name: String, type: int, default_value: Variant) -> void:
	if not ProjectSettings.has_setting(name):
		ProjectSettings.set_setting(name, default_value)
	ProjectSettings.set_initial_value(name, default_value)
	var info := {
		"name": name,
		"type": type,
	}
	ProjectSettings.add_property_info(info)

func _start_editor_bridge() -> void:
	var bridge_script = load("res://addons/godot_universal_mcp/editor_bridge.gd")
	if bridge_script == null:
		push_error("[GodotUniversalMCP] Could not load editor_bridge.gd")
		return
	editor_bridge = Node.new()
	editor_bridge.name = "GodotUniversalMCPBridge"
	editor_bridge.set_script(bridge_script)
	add_child(editor_bridge)

func _stop_editor_bridge() -> void:
	if editor_bridge != null:
		editor_bridge.queue_free()
		editor_bridge = null

func _add_dock() -> void:
	var dock_scene = load("res://addons/godot_universal_mcp/dock.tscn")
	if dock_scene == null:
		push_warning("[GodotUniversalMCP] Could not load dock.tscn, skipping dock")
		return
	dock = dock_scene.instantiate()
	add_control_to_dock(DOCK_SLOT_LEFT_BR, dock)

func _remove_dock() -> void:
	if dock != null:
		remove_control_from_docks(dock)
		dock.queue_free()
		dock = null

func enable_autoload() -> void:
	if not _autoload_registered:
		add_autoload_singleton(AUTOLOAD_NAME, AUTOLOAD_PATH)
		_autoload_registered = true

func disable_autoload() -> void:
	if _autoload_registered:
		remove_autoload_singleton(AUTOLOAD_NAME)
		_autoload_registered = false
