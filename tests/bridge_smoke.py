#!/usr/bin/env python3
"""Real Godot integration fixtures; all writes and user data use temporary directories."""
from __future__ import annotations
import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import uuid

REPO = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Peer:
    def __init__(self, port: int, token: str = "") -> None:
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
        self.reader = self.sock.makefile("rb")
        self.token = token

    def close(self) -> None:
        self.reader.close()
        self.sock.close()

    def request(self, tool: str, params: dict | None = None) -> dict:
        request_id = str(uuid.uuid4())
        self.sock.sendall((json.dumps({"id": request_id, "type": "request", "protocolVersion": 1,
                                      "tool": tool, "params": params or {}, "token": self.token}) + "\n").encode())
        result = self.read()
        assert result["id"] == request_id, result
        return result

    def read(self) -> dict:
        line = self.reader.readline(8 * 1024 * 1024 + 2)
        assert line and len(line) <= 8 * 1024 * 1024 + 1, "Missing or oversized response"
        return json.loads(line)


def wait_for_bridge(port: int, process: subprocess.Popen, token: str) -> Peer:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        assert process.poll() is None, f"Godot exited early: {process.returncode}"
        try:
            return Peer(port, token)
        except OSError:
            time.sleep(0.1)
    raise TimeoutError(f"Bridge did not listen on port {port}")


def ok(response: dict) -> dict:
    assert response["ok"], response
    return response["result"]


def eventually(peer: Peer, command: str, predicate, params: dict | None = None) -> dict:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        response = peer.request(command, params)
        if response["ok"] and predicate(response["result"]):
            return response["result"]
        time.sleep(0.05)
    raise AssertionError(f"Condition failed for {command}: {response}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--godot", required=True)
    parser.add_argument("--csharp", action="store_true")
    parser.add_argument("--sdk-version", default="4.4.1")
    parser.add_argument("--rendered", action="store_true")
    parser.add_argument("--mcp", action="store_true")
    args = parser.parse_args()
    binary = shutil.which(args.godot) or args.godot
    assert Path(binary).is_file(), f"Godot binary not found: {binary}"
    editor_port, runtime_port = free_port(), free_port()
    while runtime_port == editor_port:
        runtime_port = free_port()
    processes: list[subprocess.Popen] = []
    peers: list[Peer] = []
    with tempfile.TemporaryDirectory(prefix="godot-mcp-smoke-") as directory:
        root = Path(directory)
        shutil.copytree(REPO / "addons/godot_universal_mcp", root / "addons/godot_universal_mcp")
        (root / "project.godot").write_text(f'''config_version=5
[application]
config/name="BridgeFixture"
run/main_scene="res://main.tscn"
config/use_custom_user_dir=true
config/custom_user_dir_name="gumcp-fixture-{uuid.uuid4().hex}"
[display]
window/size/viewport_width=320
window/size/viewport_height=240
[rendering]
renderer/rendering_method="gl_compatibility"
[editor_plugins]
enabled=PackedStringArray("res://addons/godot_universal_mcp/plugin.cfg")
[godot_universal_mcp]
editor_port={editor_port}
runtime_port={runtime_port}
runtime_enabled=true
allow_editor_property_writes=true
allow_runtime_property_writes=true
allow_runtime_input=true
allowed_input_actions=PackedStringArray("fixture_interact")
allow_snapshot_providers=true
[dotnet]
project/assembly_name="BridgeFixture"
''', encoding="utf-8")
        script = "Fixture.cs" if args.csharp else "fixture.gd"
        property_name = "Energy" if args.csharp else "energy"
        if args.csharp:
            (root / script).write_text('using Godot;\n[Tool]\npublic partial class Fixture : Node2D { [Export] public int Energy { get; set; } = 7; }\n', encoding="utf-8")
            (root / "BridgeFixture.csproj").write_text(f'<Project Sdk="Godot.NET.Sdk/{args.sdk_version}"><PropertyGroup><TargetFramework>net8.0</TargetFramework><EnableDynamicLoading>true</EnableDynamicLoading></PropertyGroup></Project>', encoding="utf-8")
            subprocess.run(["dotnet", "build", "BridgeFixture.csproj"], cwd=root, check=True, timeout=180)
        else:
            (root / script).write_text('@tool\nextends Node2D\n@export var energy: int = 7\n', encoding="utf-8")
        (root / "observer.gd").write_text(f'''extends Node
@export var presses: int = 0
@export var releases: int = 0
func _ready() -> void:
    InputMap.add_action("fixture_interact")
    add_to_group("godot_mcp_snapshot_provider")
func _input(event: InputEvent) -> void:
    if event is InputEventAction and event.action == "fixture_interact":
        if event.pressed:
            presses += 1
        else:
            releases += 1
func get_mcp_snapshot() -> Dictionary:
    return {{"energy": get_parent().get("{property_name}"), "presses": presses, "releases": releases}}
''', encoding="utf-8")
        (root / "main.tscn").write_text(f'''[gd_scene load_steps=3 format=3]
[ext_resource type="Script" path="res://{script}" id="1"]
[ext_resource type="Script" path="res://observer.gd" id="2"]
[node name="Fixture" type="Node2D"]
script = ExtResource("1")
[node name="Child" type="Node2D" parent="."]
[node name="Observer" type="Node" parent="."]
script = ExtResource("2")
[node name="Color" type="ColorRect" parent="."]
offset_right = 120.0
offset_bottom = 120.0
color = Color(0.2, 0.6, 0.8, 1)
''', encoding="utf-8")
        env = os.environ.copy()
        env.pop("GODOT_MCP_TOKEN", None)
        env["XDG_DATA_HOME"] = str(root / "userdata")
        env["XDG_CONFIG_HOME"] = str(root / "userconfig")
        log_path = root / "godot.log"
        try:
            with log_path.open("w", encoding="utf-8") as log:
                flags = [] if args.rendered else ["--headless"]
                editor = subprocess.Popen([binary, *flags, "--editor", "--path", str(root), "res://main.tscn"], stdout=log, stderr=log, env=env)
                processes.append(editor)
                unauthenticated = wait_for_bridge(editor_port, editor, "")
                peers.append(unauthenticated)
                assert unauthenticated.request("editor.get_status")["error"]["code"] == "AUTH_REQUIRED"
                token_path = root / ".godot/godot_universal_mcp/token"
                token = token_path.read_text().strip()
                assert len(token) == 64
                if os.name != "nt":
                    assert token_path.stat().st_mode & 0o077 == 0
                editor_peer = Peer(editor_port, token)
                peers.append(editor_peer)
                status = ok(editor_peer.request("editor.get_status"))
                assert status["sessionId"] and status["protocolVersion"] == 1
                assert Path(status["projectPath"]).resolve() == root.resolve()
                assert status["capabilities"]["requiresDotNet"] is False
                assert status["capabilities"]["csharpAvailable"] == args.csharp
                tree = eventually(editor_peer, "editor.get_scene_tree", lambda data: data["path"] == ".")
                assert tree["childCount"] == 3
                assert ok(editor_peer.request("editor.get_scene_tree", {"max_nodes": 1}))["truncated"]
                node = ok(editor_peer.request("editor.get_node", {"node_path": "."}))
                assert node["scriptLanguage"] == ("CSharpScript" if args.csharp else "GDScript")
                assert any(p["name"] == property_name for p in node["properties"]), node
                assert editor_peer.request("editor.get_node", {"node_path": ".."})["error"]["code"] == "VALIDATION_ERROR"
                assert editor_peer.request("editor.get_node", {"node_path": ".", "scene_path": "res://missing.tscn"})["error"]["code"] == "TOOL_NOT_AVAILABLE"
                assert ok(editor_peer.request("editor.set_node_property", {"node_path": ".", "property": "position", "value": {"x": 20, "y": 40}}))["value"] == {"x": 20, "y": 40}
                ok(editor_peer.request("editor.set_node_property", {"node_path": ".", "property": property_name, "value": 9}))
                assert editor_peer.request("editor.set_node_property", {"node_path": ".", "property": property_name, "value": 1.5})["error"]["code"] == "VALIDATION_ERROR"
                assert editor_peer.request("editor.get_output")["error"]["code"] == "NOT_IMPLEMENTED"
                editor_peer.sock.sendall(b'[]\n')
                assert editor_peer.read()["error"]["code"] == "VALIDATION_ERROR"
                batch = [{"id": f"batch-{i}", "type": "request", "tool": "editor.get_capabilities", "params": {}, "token": token} for i in range(24)]
                editor_peer.sock.sendall("".join(json.dumps(item) + "\n" for item in batch).encode())
                for item in batch:
                    response = editor_peer.read()
                    assert response["id"] == item["id"] and response["ok"], response
                # Plugin is the only autoload owner. Its persisted entry must exist now.
                assert 'GodotUniversalMcpRuntime="*res://addons/godot_universal_mcp/runtime_bridge.gd"' in (root / "project.godot").read_text()
                runtime = subprocess.Popen([binary, *flags, "--path", str(root)], stdout=log, stderr=log, env=env)
                processes.append(runtime)
                game = wait_for_bridge(runtime_port, runtime, token)
                peers.append(game)
                game_status = eventually(game, "runtime.get_status", lambda data: data["ready"])
                assert game_status["sessionId"] != status["sessionId"]
                assert Path(game_status["projectPath"]).resolve() == root.resolve()
                ok(game.request("runtime.get_tree"))
                assert ok(game.request("runtime.get_node", {"node_path": "Fixture"}))["hasScript"]
                assert game.request("runtime.get_tree", {"max_depth": 13})["error"]["code"] == "VALIDATION_ERROR"
                manifest = json.loads((REPO / "addons/godot_universal_mcp/tool_manifest.json").read_text())
                for target, peer in [("editor", editor_peer), ("runtime", game)]:
                    expected = {s["command"] for s in manifest["tools"] if s["target"] == target and "command" in s}
                    assert set(ok(peer.request(f"{target}.get_capabilities"))["tools"]) == expected
                    for command in expected:
                        response = peer.request(command, {"unknown_parameter": 1})
                        assert response["error"]["code"] == "VALIDATION_ERROR", response
                snapshot = ok(game.request("runtime.get_snapshot"))
                assert snapshot["semanticSupported"]
                assert snapshot["providers"][0]["data"]["energy"] == 7
                assert snapshot["diagnostics"]["last_errors"] is None
                assert game.request("runtime.send_action", {"action": "not_allowed", "phase": "pressed"})["error"]["code"] == "WRITE_DISABLED"
                ok(game.request("runtime.send_action", {"action": "fixture_interact", "phase": "pressed", "hold_ms": 100}))
                eventually(game, "runtime.get_snapshot", lambda data: data["providers"][0]["data"]["releases"] == 1)
                ok(game.request("runtime.pause"))
                assert ok(game.request("runtime.get_status"))["paused"] is True
                ok(game.request("runtime.resume"))
                assert ok(game.request("runtime.get_status"))["paused"] is False
                if args.rendered:
                    image = eventually(game, "runtime.screenshot", lambda data: data["renderedFrames"] > 2)
                    assert base64.b64decode(image["base64"])[:8] == b'\x89PNG\r\n\x1a\n'
                    assert image["sessionId"] == game_status["sessionId"]
                    assert image["currentScene"] == "res://main.tscn" and image["width"] <= 1024
                else:
                    assert game.request("runtime.screenshot")["error"]["code"] == "TOOL_NOT_AVAILABLE"
                assert game.request("runtime.get_logs")["error"]["code"] == "NOT_IMPLEMENTED"
                game.close()
                peers.remove(game)
                runtime.terminate()
                runtime.wait(timeout=10)
                if args.mcp:
                    config_dir = root / ".godot-universal-mcp"
                    config_dir.mkdir(exist_ok=True)
                    (config_dir / "config.json").write_text(json.dumps({"tcp": {"editorPort": editor_port, "runtimePort": runtime_port}, "security": {"allowWrite": True, "trustMode": "trusted"}}))
                    subprocess.run(["node", str(REPO / "tests/mcp_smoke.cjs"), str(root)], cwd=REPO, env=env, check=True, timeout=120)
                print(f"PASS: real Godot {'C#' if args.csharp else 'GDScript'}, auth, manifest, typed writes, snapshots, InputMap lease, pause/resume, rendered={args.rendered}")
        finally:
            for peer in peers:
                peer.close()
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            if log_path.exists():
                text = log_path.read_text(errors="replace")
                print(text[-20000:])
                assert "SCRIPT ERROR:" not in text, "Godot reported script errors"


if __name__ == "__main__":
    main()
