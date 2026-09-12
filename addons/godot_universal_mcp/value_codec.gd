@tool
extends RefCounted

## Bounded JSON conversion; never evaluate code or deserialize arbitrary resources.
static func encode(value: Variant, depth: int = 0, budget: Dictionary = {}) -> Variant:
	if budget.is_empty():
		budget = {"remaining": 1024, "characters": 65536}
	if depth > 6 or int(budget.remaining) <= 0:
		return {"truncated": true}
	budget.remaining -= 1
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT:
			return value
		TYPE_FLOAT:
			return value if is_finite(value) else null
		TYPE_STRING, TYPE_STRING_NAME, TYPE_NODE_PATH:
			var text := str(value)
			var length := mini(text.length(), mini(8192, int(budget.characters)))
			budget.characters -= length
			return text if length == text.length() else {"value": text.left(length), "truncated": true}
		TYPE_VECTOR2, TYPE_VECTOR2I:
			return {"x": _finite(value.x), "y": _finite(value.y)}
		TYPE_VECTOR3, TYPE_VECTOR3I:
			return {"x": _finite(value.x), "y": _finite(value.y), "z": _finite(value.z)}
		TYPE_COLOR:
			return {"r": _finite(value.r), "g": _finite(value.g), "b": _finite(value.b), "a": _finite(value.a)}
		TYPE_ARRAY, TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY:
			var result: Array = []
			for index in range(mini(value.size(), 128)):
				if int(budget.remaining) <= 0:
					break
				result.append(encode(value[index], depth + 1, budget))
			if result.size() < value.size():
				result.append({"truncated": true})
			return result
		TYPE_DICTIONARY:
			var result: Dictionary = {}
			var visited := 0
			for key in value:
				if visited >= 128 or int(budget.remaining) <= 0 or int(budget.characters) <= 0:
					result["__truncated__"] = true
					break
				visited += 1
				var name := str(key)
				if name.length() > 256 or name.length() > int(budget.characters):
					result["__truncated__"] = true
					continue
				budget.characters -= name.length()
				result[name] = encode(value[key], depth + 1, budget)
			return result
		TYPE_OBJECT:
			if not is_instance_valid(value):
				return null
			return {"type": value.get_class(), "resourcePath": str(value.resource_path).left(4096) if value is Resource else ""}
		_:
			return {"type": type_string(typeof(value)), "supported": false}

static func _finite(value: Variant) -> Variant:
	return value if is_finite(float(value)) else null

static func property_info(node: Object, property: String) -> Dictionary:
	for info in node.get_property_list():
		if str(info.name) == property:
			return info
	return {}

static func decode(value: Variant, info: Dictionary) -> Dictionary:
	var type: int = int(info.get("type", TYPE_NIL))
	match type:
		TYPE_BOOL:
			if value is bool:
				return {"ok": true, "value": value}
		TYPE_INT:
			if _number(value) and absf(float(value)) <= 9007199254740991.0 and float(value) == floor(float(value)):
				return {"ok": true, "value": int(value)}
		TYPE_FLOAT:
			if _number(value):
				return {"ok": true, "value": float(value)}
		TYPE_STRING, TYPE_STRING_NAME, TYPE_NODE_PATH:
			if value is String:
				var converted: Variant = value
				if type == TYPE_STRING_NAME:
					converted = StringName(value)
				elif type == TYPE_NODE_PATH:
					converted = NodePath(value)
				return {"ok": true, "value": converted}
		TYPE_VECTOR2:
			if _components(value, ["x", "y"]):
				return {"ok": true, "value": Vector2(value.x, value.y)}
		TYPE_VECTOR3:
			if _components(value, ["x", "y", "z"]):
				return {"ok": true, "value": Vector3(value.x, value.y, value.z)}
		TYPE_COLOR:
			if _components(value, ["r", "g", "b", "a"]):
				return {"ok": true, "value": Color(value.r, value.g, value.b, value.a)}
	return {"ok": false, "message": "Unsupported or mismatched property value for " + type_string(type)}

static func _number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))

static func _components(value: Variant, keys: Array) -> bool:
	if not (value is Dictionary) or value.size() != keys.size():
		return false
	for key in keys:
		if not value.has(key) or not _number(value[key]):
			return false
	return true

static func node_info(node: Node, root: Node, include_properties: bool = false) -> Dictionary:
	var script: Script = node.get_script()
	var result := {
		"name": str(node.name), "type": node.get_class(), "path": str(root.get_path_to(node)),
		"groups": encode(node.get_groups()), "hasScript": script != null,
		"scriptPath": script.resource_path if script != null else "",
		"scriptLanguage": script.get_class() if script != null else "none",
	}
	if include_properties:
		var properties: Array = []
		var budget := {"remaining": 1024, "characters": 65536}
		for info in node.get_property_list():
			if (int(info.usage) & PROPERTY_USAGE_STORAGE) == 0 or str(info.name) in ["script", "owner"]:
				continue
			if properties.size() >= 128 or int(budget.remaining) <= 0:
				result["propertiesTruncated"] = true
				break
			properties.append({"name": str(info.name), "type": type_string(int(info.type)), "value": encode(node.get(info.name), 0, budget)})
		result["properties"] = properties
	return result

static func tree(node: Node, root: Node, depth: int, budget: Dictionary) -> Dictionary:
	budget.remaining -= 1
	var result := node_info(node, root)
	var children: Array = []
	var descendant_truncated := false
	if depth > 0:
		for child in node.get_children():
			if int(budget.remaining) <= 0:
				break
			var child_info := tree(child, root, depth - 1, budget)
			descendant_truncated = descendant_truncated or bool(child_info.truncated)
			children.append(child_info)
	result["children"] = children
	result["childCount"] = node.get_child_count()
	result["truncated"] = descendant_truncated or children.size() < node.get_child_count()
	return result

static func valid_node_path(value: Variant) -> bool:
	return value is String and not value.is_empty() and value.length() <= 1024 and not value.begins_with("/") and not ":" in value and not "\\" in value and not ".." in value.split("/")
