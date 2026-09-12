#!/usr/bin/env python3
"""Real headless Godot integration test. Uses only Python's standard library.

python tests/bridge_smoke.py --godot /absolute/path/to/godot
Add --csharp --sdk-version 4.4.1 for a Godot .NET binary plus .NET 8 SDK.
All project writes happen in a temporary fixture, never in a user's game.
"""
from __future__ import annotations

import argparse
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
        self.sock.sendall((json.dumps({"id": request_id, "type": "request", "tool": tool,
                                      "params": params or {}, "token": self.token}) + "\n").encode())
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
        if process.poll() is not None:
            raise AssertionError(f"Godot exited early: {process.returncode}")
        try:
            return Peer(port, token)
        except OSError:
            time.sleep(0.1)
    raise TimeoutError(f"Bridge did not listen on port {port}")


def ok(response: dict) -> dict:
    assert response["ok"], response
    return response["result"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--godot", required=True)
    parser.add_argument("--csharp", action="store_true")
    parser.add_argument("--sdk-version", default="4.4.1")
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
[rendering]
renderer/rendering_method="gl_compatibility"
[editor_plugins]
enabled=PackedStringArray("res://addons/godot_universal_mcp/plugin.cfg")
[autoload]
GodotUniversalMcpRuntime="*res://addons/godot_universal_mcp/runtime_bridge.gd"
[godot_universal_mcp]
editor_port={editor_port}
runtime_port={runtime_port}
runtime_enabled=true
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
        (root / "main.tscn").write_text(f'''[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://{script}" id="1"]
[node name="Fixture" type="Node2D"]
script = ExtResource("1")
[node name="Child" type="Node2D" parent="."]
''', encoding="utf-8")
        env = os.environ.copy()
        env.pop("GODOT_MCP_TOKEN", None)  # Exercise automatic per-project credentials.
        log_path = root / "godot.log"
        try:
            with log_path.open("w", encoding="utf-8") as log:
                editor = subprocess.Popen([binary, "--headless", "--editor", "--path", str(root), "res://main.tscn"], stdout=log, stderr=log, env=env)
                processes.append(editor)
                unauthenticated = wait_for_bridge(editor_port, editor, "")
                peers.append(unauthenticated)
                assert unauthenticated.request("editor.get_status")["error"]["code"] == "AUTH_REQUIRED"
                token = (root / ".godot/godot_universal_mcp/token").read_text().strip()
                assert len(token) == 64
                if os.name != "nt":
                    assert (root / ".godot/godot_universal_mcp/token").stat().st_mode & 0o077 == 0
                editor_peer = Peer(editor_port, token)
                peers.append(editor_peer)
                status = ok(editor_peer.request("editor.get_status"))
                assert status["capabilities"]["requiresDotNet"] is False
                assert status["capabilities"]["csharpAvailable"] == args.csharp
                deadline = time.monotonic() + 15
                while True:
                    tree = editor_peer.request("editor.get_scene_tree")
                    if tree["ok"]:
                        break
                    assert time.monotonic() < deadline, tree
                    time.sleep(0.1)
                assert ok(tree)["path"] == "."
                node = ok(editor_peer.request("editor.get_node", {"node_path": "."}))
                assert node["scriptLanguage"] == ("CSharpScript" if args.csharp else "GDScript")
                assert any(p["name"] == property_name for p in node["properties"]), node
                assert editor_peer.request("editor.get_node", {"node_path": ".."})["error"]["code"] == "VALIDATION_ERROR"
                assert editor_peer.request("editor.get_node", {"node_path": ".", "scene_path": "res://missing.tscn"})["error"]["code"] == "TOOL_NOT_AVAILABLE"
                result = ok(editor_peer.request("editor.set_node_property", {"node_path": ".", "property": "position", "value": {"x": 20, "y": 40}}))
                assert result["value"] == {"x": 20, "y": 40}
                ok(editor_peer.request("editor.set_node_property", {"node_path": ".", "property": property_name, "value": 9}))
                assert editor_peer.request("editor.set_node_property", {"node_path": ".", "property": property_name, "value": 1.5})["error"]["code"] == "VALIDATION_ERROR"
                assert editor_peer.request("editor.get_output")["error"]["code"] == "NOT_IMPLEMENTED"
                editor_peer.sock.sendall(b'[]\n')
                assert editor_peer.read()["error"]["code"] == "VALIDATION_ERROR"
                # More than the per-frame budget, sent in a single write. No later data arrives.
                batch = [{"id": f"batch-{i}", "type": "request", "tool": "editor.get_capabilities", "params": {}, "token": token} for i in range(24)]
                editor_peer.sock.sendall("".join(json.dumps(item) + "\n" for item in batch).encode())
                for item in batch:
                    response = editor_peer.read()
                    assert response["id"] == item["id"] and response["ok"], response
                runtime = subprocess.Popen([binary, "--headless", "--path", str(root)], stdout=log, stderr=log, env=env)
                processes.append(runtime)
                game = wait_for_bridge(runtime_port, runtime, token)
                peers.append(game)
                ok(game.request("runtime.get_tree"))
                assert ok(game.request("runtime.get_node", {"node_path": "Fixture"}))["hasScript"]
                ok(game.request("runtime.pause"))
                assert ok(game.request("runtime.get_status"))["paused"] is True
                ok(game.request("runtime.resume"))
                assert ok(game.request("runtime.get_status"))["paused"] is False
                assert game.request("runtime.screenshot")["error"]["code"] == "TOOL_NOT_AVAILABLE"
                assert game.request("runtime.get_logs")["error"]["code"] == "NOT_IMPLEMENTED"
                print(f"PASS: real Godot {'C#' if args.csharp else 'GDScript'} editor/runtime, authentication, typed writes, batching and pause/resume")
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
                print(text[-16000:])
                assert "SCRIPT ERROR:" not in text, "Godot reported script errors; see log above"


if __name__ == "__main__":
    main()
