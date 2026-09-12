@tool
extends RefCounted

## Private NDJSON transport, not the public MCP transport. Main-thread, bounded I/O.
const MAX_CLIENTS := 8
const MAX_REQUEST_BYTES := 1024 * 1024
const MAX_RESPONSE_BYTES := 8 * 1024 * 1024
const IO_BUDGET := 64 * 1024
const REQUEST_BUDGET := 8
const IDLE_TIMEOUT_MS := 120000
const TOKEN_PATH := "res://.godot/godot_universal_mcp/token"

var _server: TCPServer
var _clients: Array[Dictionary] = []
var _handler: Callable
var _token := ""
var last_error := "Not started"

static func read_token(create: bool = false) -> String:
	var token := OS.get_environment("GODOT_MCP_TOKEN").strip_edges()
	if not token.is_empty():
		return token if token.length() >= 32 and token.length() <= 256 else ""
	if FileAccess.file_exists(TOKEN_PATH):
		token = FileAccess.get_file_as_string(TOKEN_PATH).strip_edges()
		if token.length() >= 32 and token.length() <= 256:
			return token
	if not create:
		return ""
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TOKEN_PATH.get_base_dir())) != OK:
		return ""
	var bytes := Crypto.new().generate_random_bytes(32)
	if bytes.size() != 32:
		return ""
	token = bytes.hex_encode()
	var file := FileAccess.open(TOKEN_PATH, FileAccess.WRITE)
	if file == null:
		return ""
	file.store_string(token)
	file.close()
	# Godot's .godot directory is local cache, not a distributable project setting.
	if OS.get_name() != "Windows":
		FileAccess.set_unix_permissions(TOKEN_PATH, 384)
	return token

func start(port: int, handler: Callable, token: String) -> Error:
	stop()
	if port < 1 or port > 65535 or token.length() < 32 or token.length() > 256:
		last_error = "Invalid port or missing authentication token"
		return ERR_INVALID_PARAMETER
	_handler = handler
	_token = token
	_server = TCPServer.new()
	var err := _server.listen(port, "127.0.0.1")
	last_error = "" if err == OK else "Cannot listen on 127.0.0.1:%d (error %d)" % [port, err]
	return err

func is_listening() -> bool:
	return _server != null and _server.is_listening()

func stop() -> void:
	for state in _clients:
		state.peer.disconnect_from_host()
	_clients.clear()
	if _server != null:
		_server.stop()
	_server = null
	_handler = Callable()
	_token = ""

func poll() -> void:
	if not is_listening():
		return
	for _index in range(MAX_CLIENTS):
		if not _server.is_connection_available():
			break
		var peer := _server.take_connection()
		if _clients.size() >= MAX_CLIENTS:
			peer.disconnect_from_host()
		else:
			_clients.append({"peer": peer, "rx": PackedByteArray(), "tx": PackedByteArray(), "seen": Time.get_ticks_msec()})
	for index in range(_clients.size() - 1, -1, -1):
		var state: Dictionary = _clients[index]
		if not _poll_client(state):
			state.peer.disconnect_from_host()
			_clients.remove_at(index)

func _poll_client(state: Dictionary) -> bool:
	var peer: StreamPeerTCP = state.peer
	peer.poll()
	if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return false
	if Time.get_ticks_msec() - int(state.seen) > IDLE_TIMEOUT_MS:
		return false
	var available := mini(peer.get_available_bytes(), IO_BUDGET)
	var rx: PackedByteArray = state.rx
	var tx: PackedByteArray = state.tx
	if available > 0:
		var data := peer.get_partial_data(available)
		if data[0] != OK:
			return false
		rx.append_array(data[1])
		state.seen = Time.get_ticks_msec()
	# Work left by REQUEST_BUDGET must also run when no new bytes arrive.
	for _index in range(REQUEST_BUDGET):
		var newline := rx.find(10)
		if newline < 0:
			break
		if newline > MAX_REQUEST_BYTES:
			return false
		var line := rx.slice(0, newline).get_string_from_utf8().strip_edges()
		rx = rx.slice(newline + 1)
		if line.is_empty():
			continue
		var response := _handle_line(line)
		var encoded := (JSON.stringify(response) + "\n").to_utf8_buffer()
		if encoded.size() > MAX_RESPONSE_BYTES:
			encoded = (JSON.stringify(_response(str(response.id), _error("RESPONSE_TOO_LARGE", "Response exceeded the limit"))) + "\n").to_utf8_buffer()
		if tx.size() + encoded.size() > MAX_RESPONSE_BYTES:
			return false
		tx.append_array(encoded)
	if rx.size() > MAX_REQUEST_BYTES:
		return false
	if not tx.is_empty():
		var sent := peer.put_partial_data(tx.slice(0, IO_BUDGET))
		if sent[0] != OK:
			return false
		tx = tx.slice(int(sent[1]))
	state.rx = rx
	state.tx = tx
	return true

func _handle_line(line: String) -> Dictionary:
	var json := JSON.new()
	if json.parse(line) != OK or not (json.data is Dictionary):
		return _response("invalid", _error("VALIDATION_ERROR", "Expected a JSON request object"))
	var msg: Dictionary = json.data
	var id: Variant = msg.get("id")
	if not (id is String) or id.is_empty() or id.length() > 128:
		return _response("invalid", _error("VALIDATION_ERROR", "Invalid request id"))
	if not (msg.get("token") is String) or msg.get("token") != _token:
		return _response(id, _error("AUTH_REQUIRED", "Missing or incorrect project bridge token"))
	if msg.get("type") != "request" or not (msg.get("tool") is String) or not (msg.get("params") is Dictionary):
		return _response(id, _error("VALIDATION_ERROR", "Expected type=request, tool string and params object"))
	var result: Dictionary = _handler.call(msg.tool, msg.params)
	return _response(id, result)

static func _response(id: String, result: Dictionary) -> Dictionary:
	return {"id": id, "type": "response", "ok": result.get("ok", false), "result": result.get("result"), "error": result.get("error")}

static func _error(code: String, message: String) -> Dictionary:
	return {"ok": false, "result": null, "error": {"code": code, "message": message, "details": {}}}
