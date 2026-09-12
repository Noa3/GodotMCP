@tool
extends VBoxContainer

var status_provider: Callable
var runtime_toggle: Callable
var _elapsed := 0.0
var _runtime: CheckBox
var _generic: CheckBox

func _ready() -> void:
	$CopyConfig.pressed.connect(_on_copy_config_pressed)
	_generic = CheckBox.new()
	_generic.text = "Generic MCP client (mcpServers)"
	add_child(_generic)
	_runtime = CheckBox.new()
	_runtime.text = "Enable runtime bridge (next game run)"
	_runtime.button_pressed = ProjectSettings.get_setting("godot_universal_mcp/runtime_enabled", false)
	_runtime.toggled.connect(_toggle_runtime)
	add_child(_runtime)
	_update_status()

func _process(delta: float) -> void:
	_elapsed += delta
	if _elapsed >= 1.0:
		_elapsed = 0.0
		_update_status()

func _toggle_runtime(enabled: bool) -> void:
	if runtime_toggle.is_valid():
		runtime_toggle.call(enabled)
	_runtime.set_pressed_no_signal(ProjectSettings.get_setting("godot_universal_mcp/runtime_enabled", false))

func _update_status() -> void:
	if not status_provider.is_valid():
		$Status.text = "Status: unavailable"
		return
	var status: Dictionary = status_provider.call()
	$Status.text = "Status: listening" if status.get("listening", false) else "Status: stopped"
	$Port.text = "Editor port: %s" % str(status.get("port", "?"))
	if not str(status.get("error", "")).is_empty():
		$Diagnostics.text = str(status.error)

func _on_copy_config_pressed() -> void:
	var config_path := "res://.godot-universal-mcp/client.json"
	if not FileAccess.file_exists(config_path):
		$Diagnostics.text = "Run the local MCP install command for this project first. No guessed npx configuration was copied."
		return
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(config_path))
	if not (data is Dictionary) or data.get("version") != 1:
		$Diagnostics.text = "Invalid local MCP configuration. Re-run install."
		return
	var root := ProjectSettings.globalize_path("res://").replace("\\", "/").trim_suffix("/")
	var configured := str(data.get("projectRoot", "")).replace("\\", "/").trim_suffix("/")
	if OS.get_name() == "Windows":
		root = root.to_lower()
		configured = configured.to_lower()
	if configured != root:
		$Diagnostics.text = "Project moved or configuration belongs to another project. Re-run install."
		return
	var key := "generic" if _generic.button_pressed else "vscode"
	var config: Variant = data.get(key)
	if not (config is Dictionary):
		$Diagnostics.text = "Missing client configuration. Re-run install."
		return
	DisplayServer.clipboard_set(JSON.stringify(config, "\t"))
	$Diagnostics.text = "Local adapter configuration copied. Credentials are not included."
