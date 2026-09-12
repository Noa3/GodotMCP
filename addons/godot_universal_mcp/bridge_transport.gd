@tool
extends RefCounted

## Private NDJSON transport; all I/O is bounded and main-thread only.
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
var _polling := false
var last_error := "Not started"

static func read_token(create: bool = false) -> String:
	var token := OS.get_environment("GODOT_MCP_TOKEN").strip_edges()
	if not token.is_empty():
		if token.length() < 32 or token.length() > 256:
			return _token_error("GODOT_MCP_TOKEN must contain 32 to 256 characters")
		return token
	var token_path := ProjectSettings.globalize_path(TOKEN_PATH)
	var directory := token_path.get_base_dir()
	if FileAccess.file_exists(token_path):
		token = FileAccess.get_file_as_string(token_path).strip_edges()
		if token.length() >= 32 and token.length() <= 256:
			return token
	if not create:
		return _token_error("Project token is missing; start the editor addon first")
	if DirAccess.make_dir_recursive_absolute(directory) != OK:
		return _token_error("Cannot create the project token directory")
	if OS.get_name() != "Windows" and FileAccess.set_unix_permissions(directory, 448) != OK:
		return _token_error("Cannot restrict token directory permissions")
	var bytes := Crypto.new().generate_random_bytes(32)
	if bytes.size() != 32:
		return _token_error("Could not generate a cryptographic project token")
	token = bytes.hex_encode()
	var file := FileAccess.open(token_path, FileAccess.WRITE)
	if file == null:
		return _token_error("Cannot open project token file for writing")
	file.store_string(token)
	file.flush()
	var write_error := file.get_error()
	# Editor safe-save creates the final path only on close.
	file.close()
	if write_error != OK:
		return _token_error("Could not write the project token")
	if OS.get_name() != "Windows" and FileAccess.set_unix_permissions(token_path, 384) != OK:
		return _token_error("Cannot restrict token file permissions")
	if not FileAccess.file_exists(token_path) or FileAccess.get_file_as_string(token_path).strip_edges() != token:
		return _token_error("Project token could not be verified after saving")
	return token

static func _token_error(message: String) -> String:
	push_error("[GodotUniversalMCP] " + message)
	return ""

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
	# Editor progress dialogs can pump a nested main loop during play/save/import.
	# Reentering here would replay a mutation before its receive buffer was committed.
	if _polling or not is_listening():
		return
	_polling = true
	_poll_clients()
	_polling = false

func _poll_clients() -> void:
	for _index in range(MAX_CLIENTS):
		if not is_listening() or not _server.is_connection_available():
			break
		var peer := _server.take_connection()
		if _clients.size() >= MAX_CLIENTS:
			peer.disconnect_from_host()
		else:
			_clients.append({"peer": peer, "rx": PackedByteArray(), "tx": PackedByteArray(), "seen": Time.get_ticks_msec()})
	# A handler may stop the server during a nested editor event; iterate a snapshot.
	for state in _clients.duplicate():
		if not is_listening():
			break
		if not _poll_client(state):
			state.peer.disconnect_from_host()
			_clients.erase(state)

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
	for _index in range(REQUEST_BUDGET):
		var newline := rx.find(10)
		if newline < 0:
			break
		if newline > MAX_REQUEST_BYTES:
			return false
		var line := rx.slice(0, newline).get_string_from_utf8().strip_edges()
		rx = rx.slice(newline + 1)
		state.rx = rx # Consume before invoking any editor or project callback.
		if line.is_empty():
			continue
		var response := _handle_line(line)
		if not is_listening():
			return false
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
	if msg.get("protocolVersion", 1) != 1:
		return _response(id, _error("VALIDATION_ERROR", "Unsupported bridge protocol version"))
	if msg.get("type") != "request" or not (msg.get("tool") is String) or not (msg.get("params") is Dictionary):
		return _response(id, _error("VALIDATION_ERROR", "Expected type=request, tool string and params object"))
	if msg.tool.is_empty() or msg.tool.length() > 128:
		return _response(id, _error("VALIDATION_ERROR", "Invalid command length"))
	var result: Dictionary = _handler.call(msg.tool, msg.params)
	return _response(id, result)

static func _response(id: String, result: Dictionary) -> Dictionary:
	return {"id": id, "type": "response", "ok": result.get("ok", false), "result": result.get("result"), "error": result.get("error")}

static func _error(code: String, message: String) -> Dictionary:
	return {"ok": false, "result": null, "error": {"code": code, "message": message, "details": {}}}
