extends RefCounted

const Transport = preload("res://addons/godot_universal_mcp/bridge_transport.gd")
const Codec = preload("res://addons/godot_universal_mcp/value_codec.gd")
var rendered_frames := 0
var last_scene := ""
var _bridge: Node
var _identity: Callable
var _pending: Dictionary = {}
var _last: Dictionary = {}

func start(bridge: Node, identity: Callable) -> void:
	_bridge = bridge
	_identity = identity
	if DisplayServer.get_name() != "headless":
		RenderingServer.frame_pre_draw.connect(_before_render)
		RenderingServer.frame_post_draw.connect(_after_render)

func stop() -> void:
	if RenderingServer.frame_pre_draw.is_connected(_before_render):
		RenderingServer.frame_pre_draw.disconnect(_before_render)
	if RenderingServer.frame_post_draw.is_connected(_after_render):
		RenderingServer.frame_post_draw.disconnect(_after_render)
	_bridge = null
	_identity = Callable()
	_pending.clear()
	_last.clear()

func _before_render() -> void:
	if not is_instance_valid(_bridge) or not _bridge.is_inside_tree():
		return
	_pending = _identity.call()
	var scene := _bridge.get_tree().current_scene
	var viewport := _bridge.get_viewport()
	var camera := viewport.get_camera_3d()
	# Older engines expose only the configured method, which may differ after a fallback.
	var actual_method: Variant = null
	if RenderingServer.has_method("get_current_rendering_method"):
		actual_method = RenderingServer.call("get_current_rendering_method")
	_pending.merge({"currentScene": scene.scene_file_path if scene else "", "frameCount": Engine.get_process_frames(),
		"engineTimeMs": Time.get_ticks_msec(), "renderer": {"actualMethod": actual_method,
			"configuredMethod": ProjectSettings.get_setting("rendering/renderer/rendering_method", "gl_compatibility")},
		"sourceWidth": int(viewport.get_visible_rect().size.x), "sourceHeight": int(viewport.get_visible_rect().size.y),
		"cameraPath": str(camera.get_path()) if camera else "", "camera": null})
	if camera != null:
		var transform := camera.global_transform
		_pending.camera = {"position": Codec.encode(transform.origin),
			"basisX": Codec.encode(transform.basis.x), "basisY": Codec.encode(transform.basis.y),
			"basisZ": Codec.encode(transform.basis.z), "fov": camera.fov}
	else:
		var camera_2d := viewport.get_camera_2d()
		if camera_2d != null:
			_pending.cameraPath = str(camera_2d.get_path())
			_pending.camera = {"position": Codec.encode(camera_2d.global_position), "rotation": camera_2d.global_rotation, "zoom": Codec.encode(camera_2d.zoom)}

func _after_render() -> void:
	if _pending.is_empty():
		return
	rendered_frames += 1
	_last = _pending.duplicate(true)
	_last["renderedFrames"] = rendered_frames
	last_scene = str(_last.get("currentScene", ""))

func capture(max_edge: int) -> Dictionary:
	if DisplayServer.get_name() == "headless":
		return Transport._error("TOOL_NOT_AVAILABLE", "Screenshots require a rendering display")
	if not is_instance_valid(_bridge):
		return Transport._error("TOOL_NOT_AVAILABLE", "Capture is not active")
	var scene := _bridge.get_tree().current_scene
	if _last.is_empty() or scene == null or last_scene != scene.scene_file_path:
		return Transport._error("BUSY", "The current scene has not rendered yet")
	var texture := _bridge.get_viewport().get_texture()
	if texture == null:
		return Transport._error("TOOL_NOT_AVAILABLE", "Viewport texture is unavailable")
	var image := texture.get_image()
	if image == null or image.is_empty():
		return Transport._error("TOOL_NOT_AVAILABLE", "No rendered frame is available")
	var scale := minf(1.0, float(max_edge) / maxf(image.get_width(), image.get_height()))
	if scale < 1.0:
		image.resize(maxi(1, int(image.get_width() * scale)), maxi(1, int(image.get_height() * scale)))
	var result := _last.duplicate(true)
	result.merge({"format": "png", "base64": Marshalls.raw_to_base64(image.save_png_to_buffer()), "width": image.get_width(), "height": image.get_height()})
	return {"ok": true, "result": result}
