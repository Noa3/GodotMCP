extends RefCounted

const Transport = preload("res://addons/godot_universal_mcp/bridge_transport.gd")
const Codec = preload("res://addons/godot_universal_mcp/value_codec.gd")
const PROVIDER_GROUP := "godot_mcp_snapshot_provider"
var _held: Dictionary = {}

func tick() -> void:
	for action in _held.keys():
		if Time.get_ticks_msec() >= int(_held[action]) or not input_allowed(action):
			_emit(action, false, 0.0)
			_held.erase(action)

func release_all() -> void:
	for action in _held:
		_emit(action, false, 0.0)
	_held.clear()

func input_allowed(action: StringName) -> bool:
	var allowed: Variant = ProjectSettings.get_setting("godot_universal_mcp/allowed_input_actions", PackedStringArray())
	if not (allowed is Array or allowed is PackedStringArray):
		return false
	return ProjectSettings.get_setting("godot_universal_mcp/allow_runtime_input", false) and InputMap.has_action(action) and action in allowed

func input_actions() -> Dictionary:
	var actions: Array = []
	var source := InputMap.get_actions()
	for action in source:
		if actions.size() >= 256:
			break
		actions.append({"name": str(action), "automationAllowed": input_allowed(action)})
	return {"ok": true, "result": {"actions": actions, "truncated": source.size() > actions.size()}}

func _emit(action: StringName, pressed: bool, strength: float) -> void:
	var event := InputEventAction.new()
	event.action = action
	event.pressed = pressed
	event.strength = strength
	Input.parse_input_event(event)

func send_action(params: Dictionary) -> Dictionary:
	var action := StringName(params.action)
	if not input_allowed(action):
		return Transport._error("WRITE_DISABLED", "This InputMap action is not explicitly enabled for automation")
	if params.phase == "released":
		if _held.has(action):
			_emit(action, false, 0.0)
			_held.erase(action)
		return {"ok": true, "result": {"action": str(action), "pressed": false}}
	if Input.is_action_pressed(action) and not _held.has(action):
		return Transport._error("BUSY", "Action is already pressed by another input source")
	var hold_ms := int(params.get("hold_ms", 100))
	_held[action] = Time.get_ticks_msec() + hold_ms
	_emit(action, true, float(params.get("strength", 1.0)))
	return {"ok": true, "result": {"action": str(action), "pressed": true, "autoReleaseMs": hold_ms}}

func snapshot(tree: SceneTree, status: Dictionary) -> Dictionary:
	var providers: Array = []
	var enabled: bool = ProjectSettings.get_setting("godot_universal_mcp/allow_snapshot_providers", false)
	var nodes: Array = tree.get_nodes_in_group(PROVIDER_GROUP) if enabled else []
	var supported := false
	for node in nodes:
		if providers.size() >= 16:
			break
		if not node.has_method("get_mcp_snapshot"):
			providers.append({"node": str(node.get_path()), "supported": false, "reason": "Provider has no get_mcp_snapshot method"})
			continue
		var value: Variant = node.call("get_mcp_snapshot")
		if not (value is Dictionary):
			providers.append({"node": str(node.get_path()), "supported": false, "reason": "Provider must return a Dictionary"})
			continue
		supported = true
		providers.append({"node": str(node.get_path()), "supported": true, "data": Codec.encode(value)})
	return {"ok": true, "result": {"engine": status, "semanticSupported": supported,
		"providers": providers, "providersTruncated": nodes.size() > providers.size(),
		"diagnostics": {"supported": false, "last_errors": null}}}
