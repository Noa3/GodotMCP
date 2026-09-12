@tool
extends EditorPlugin

const AUTOLOAD_NAME := "GodotUniversalMcpRuntime"
const AUTOLOAD_PATH := "res://addons/godot_universal_mcp/runtime_bridge.gd"
var editor_bridge: Node
var dock: Control

func _enter_tree() -> void:
	_add_setting("editor_port", TYPE_INT, 9500)
	_add_setting("runtime_port", TYPE_INT, 9501)
	_add_setting("runtime_enabled", TYPE_BOOL, false)
	_add_setting("server_entry", TYPE_STRING, "")
	# Construct the script instance; do not call EditorPlugin methods on a plain Node.
	editor_bridge = preload("res://addons/godot_universal_mcp/editor_bridge.gd").new()
	editor_bridge.name = "GodotUniversalMCPBridge"
	editor_bridge.set("undo_redo", get_undo_redo())
	add_child(editor_bridge)
	dock = preload("res://addons/godot_universal_mcp/dock.tscn").instantiate()
	dock.set("status_provider", Callable(editor_bridge, "connection_status"))
	dock.set("runtime_toggle", _set_runtime_enabled)
	add_control_to_dock(DOCK_SLOT_LEFT_BR, dock)
	if ProjectSettings.get_setting("godot_universal_mcp/runtime_enabled", false):
		enable_autoload()

func _exit_tree() -> void:
	if is_instance_valid(dock):
		remove_control_from_docks(dock)
		dock.free()
	dock = null
	if is_instance_valid(editor_bridge):
		editor_bridge.free()
	editor_bridge = null

func _disable_plugin() -> void:
	disable_autoload()

func _add_setting(suffix: String, type: int, default_value: Variant) -> void:
	var key := "godot_universal_mcp/" + suffix
	if not ProjectSettings.has_setting(key):
		ProjectSettings.set_setting(key, default_value)
	ProjectSettings.set_initial_value(key, default_value)
	ProjectSettings.add_property_info({"name": key, "type": type})

func _set_runtime_enabled(enabled: bool) -> void:
	if enabled:
		enable_autoload()
	else:
		disable_autoload()

func enable_autoload() -> void:
	var existing: String = ProjectSettings.get_setting("autoload/" + AUTOLOAD_NAME, "")
	if not existing.is_empty() and existing != "*" + AUTOLOAD_PATH:
		push_error("[GodotUniversalMCP] Autoload name is already used by another script")
		return
	ProjectSettings.set_setting("godot_universal_mcp/runtime_enabled", true)
	if existing.is_empty():
		add_autoload_singleton(AUTOLOAD_NAME, AUTOLOAD_PATH)
	ProjectSettings.save()

func disable_autoload() -> void:
	# Read persisted state: a process-local boolean is wrong after an editor restart.
	if ProjectSettings.get_setting("autoload/" + AUTOLOAD_NAME, "") == "*" + AUTOLOAD_PATH:
		remove_autoload_singleton(AUTOLOAD_NAME)
	ProjectSettings.set_setting("godot_universal_mcp/runtime_enabled", false)
	ProjectSettings.save()
