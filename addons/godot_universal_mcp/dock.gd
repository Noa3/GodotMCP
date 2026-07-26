@tool
extends VBoxContainer

var _status_label: Label
var _port_label: Label
var _diag_label: RichTextLabel

func _ready() -> void:
	_status_label = get_node_or_null("Status")
	_port_label = get_node_or_null("Port")
	_diag_label = get_node_or_null("Diagnostics")
	
	var copy_btn = get_node_or_null("CopyConfig")
	if copy_btn:
		copy_btn.pressed.connect(_on_copy_config_pressed)
	
	_update_status()

func _update_status() -> void:
	var port := ProjectSettings.get_setting("godot_universal_mcp/editor_port", 9500)
	if _port_label:
		_port_label.text = "Editor Port: %d" % port
	if _status_label:
		_status_label.text = "Status: Active"

func _on_copy_config_pressed() -> void:
	var config := {
		"servers": {
			"godot-universal": {
				"type": "stdio",
				"command": "npx",
				"args": ["-y", "godot-universal-mcp"]
			}
		}
	}
	DisplayServer.clipboard_set(JSON.stringify(config, "\t"))
	if _diag_label:
		_diag_label.text = "MCP config copied to clipboard!"
