@tool
extends RefCounted

## JSON conversion without eval, str_to_var, resource loading or method invocation.
static func encode(value: Variant, depth: int = 0) -> Variant:
	if depth > 6:
		return {"truncated": true}
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_STRING:
			return value
		TYPE_FLOAT:
			return value if is_finite(value) else null
		TYPE_STRING_NAME, TYPE_NODE_PATH:
			return str(value)
		TYPE_VECTOR2, TYPE_VECTOR2I:
			return {"x": value.x, "y": value.y}
		TYPE_VECTOR3, TYPE_VECTOR3I:
			return {"x": value.x, "y": value.y, "z": value.z}
		TYPE_COLOR:
			return {"r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_ARRAY, TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY:
			var result: Array = []
			for index in range(mini(value.size(), 128)):
				result.append(encode(value[index], depth + 1))
			if value.size() > 128:
				result.append({"truncated": true})
			return result
		TYPE_DICTIONARY:
			var result: Dictionary = {}
			for key in value:
				if result.size() >= 128:
					result["__truncated__"] = true
					break
				result[str(key)] = encode(value[key], depth + 1)
			return result
		TYPE_OBJECT:
			if not is_instance_valid(value):
				return null
			return {"type": value.get_class(), "resourcePath": value.resource_path if value is Resource else ""}
		_:
			return {"type": type_string(typeof(value)), "supported": false}

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
		"name": str(node.name), "type": node.get_class(),
		"path": str(root.get_path_to(node)), "groups": Array(node.get_groups()),
		"hasScript": script != null,
		"scriptPath": script.resource_path if script != null else "",
		"scriptLanguage": script.get_class() if script != null else "none",
	}
	if include_properties:
		var properties: Array = []
		for info in node.get_property_list():
			if (int(info.usage) & PROPERTY_USAGE_STORAGE) == 0 or str(info.name) in ["script", "owner"]:
				continue
			if properties.size() >= 128:
				result["propertiesTruncated"] = true
				break
			properties.append({"name": str(info.name), "type": type_string(int(info.type)), "value": encode(node.get(info.name))})
		result["properties"] = properties
	return result

static func tree(node: Node, root: Node, depth: int, budget: Dictionary) -> Dictionary:
	budget.remaining -= 1
	var result := node_info(node, root)
	var children: Array = []
	if depth > 0:
		for child in node.get_children():
			if int(budget.remaining) <= 0:
				break
			children.append(tree(child, root, depth - 1, budget))
	result["children"] = children
	result["childCount"] = node.get_child_count()
	result["truncated"] = children.size() < node.get_child_count()
	return result

static func valid_node_path(value: Variant) -> bool:
	return value is String and not value.is_empty() and not value.begins_with("/") and not ":" in value and not ".." in value.split("/")
