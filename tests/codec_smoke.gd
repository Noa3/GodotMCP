extends SceneTree
const Codec = preload("res://addons/godot_universal_mcp/value_codec.gd")

func _initialize() -> void:
	var repeated: Array = [1, 2, 3]
	for _level in range(5):
		var next: Array = []
		for _index in range(128):
			next.append(repeated)
		repeated = next
	var encoded: Variant = Codec.encode(repeated)
	var json := JSON.stringify(encoded)
	if json.length() > 100000 or not json.contains("truncated"):
		push_error("Codec did not apply a shared work budget")
		quit(1)
		return
	if Codec.encode("x".repeat(100000)).get("truncated", false) != true:
		push_error("String limit was not applied")
		quit(1)
		return
	if Codec.valid_node_path("A\\B") or Codec.valid_node_path("../A"):
		quit(1)
		return
	print("PASS: global nested-value budget, string bounds and node path checks")
	quit(0)
