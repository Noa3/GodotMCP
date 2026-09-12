@tool
extends RefCounted

const MANIFEST_PATH := "res://addons/godot_universal_mcp/tool_manifest.json"
var _manifest: Dictionary = {}

func _init() -> void:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST_PATH))
	if parsed is Dictionary and parsed.get("version") == 1:
		_manifest = parsed

func commands(target: String) -> Array:
	var result: Array = []
	for spec in _manifest.get("tools", []):
		if spec.get("target") == target and spec.has("command") and not spec.command in result:
			result.append(spec.command)
	return result

func validate(command: String, params: Dictionary) -> String:
	for spec in _manifest.get("tools", []):
		if spec.get("command", "") != command:
			continue
		for required in spec.get("required", []):
			if not params.has(required):
				return "Missing parameter: " + required
		for key in params:
			if not spec.params.has(key):
				return "Unknown parameter: " + str(key)
			var field: Dictionary = _manifest.fields[spec.params[key]]
			var value: Variant = params[key]
			match field.get("type", "any"):
				"string":
					if not (value is String) or value.length() < int(field.get("minLength", 0)) or value.length() > int(field.get("maxLength", 65536)):
						return "Invalid string parameter: " + str(key)
					if field.has("enum") and not value in field.enum:
						return "Invalid option: " + str(key)
				"integer", "number":
					if not (value is int or value is float) or not is_finite(float(value)):
						return "Invalid numeric parameter: " + str(key)
					if field.type == "integer" and float(value) != floor(float(value)):
						return "Expected integer: " + str(key)
					if value < field.get("minimum", -INF) or value > field.get("maximum", INF):
						return "Out-of-range parameter: " + str(key)
				"boolean":
					if not (value is bool):
						return "Expected boolean: " + str(key)
		return ""
	return "Unknown bridge command: " + command
