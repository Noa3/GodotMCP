@tool
extends VBoxContainer

var status_provider: Callable
var runtime_toggle: Callable
var _elapsed := 0.0

func _ready() -> void:
	$CopyConfig.pressed.connect(_on_copy_config_pressed)
	var toggle := CheckBox.new()
	toggle.text = "Runtime bridge (next game run)"
	toggle.button_pressed = ProjectSettings.get_setting("godot_universal_mcp/runtime_enabled", false)
	toggle.toggled.connect(func(enabled: bool) -> void:
		if runtime_toggle.is_valid():
			runtime_toggle.call(enabled)
	)
	add_child(toggle)
	_update_status()

func _process(delta: float) -> void:
	_elapsed += delta
	if _elapsed >= 1.0:
		_elapsed = 0.0
		_update_status()

func _update_status() -> void:
	if not status_provider.is_valid():
		$Status.text = "Status: unavailable"
		return
	var status: Dictionary = status_provider.call()
	$Port.text = "Editor port: %d" % int(status.port)
	$Status.text = "Status: listening (authenticated)" if status.listening else "Status: stopped — " + str(status.error)

func _on_copy_config_pressed() -> void:
	var entry: String = ProjectSettings.get_setting("godot_universal_mcp/server_entry", "")
	if entry.is_empty() or not FileAccess.file_exists(entry):
		$Diagnostics.text = "Set godot_universal_mcp/server_entry in Project Settings to the absolute path of your built GodotMCP/dist/cli/index.js. See README."
		return
	var config := {"servers": {"godot-universal": {"type": "stdio", "command": "node", "args": [ProjectSettings.globalize_path(entry)], "env": {"GODOT_PROJECT_ROOT": ProjectSettings.globalize_path("res://")}}}}
	DisplayServer.clipboard_set(JSON.stringify(config, "\t"))
	$Diagnostics.text = "VS Code MCP config copied. Project token is read from local cache, not copied to the clipboard."
