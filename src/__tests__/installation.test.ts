import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInstall } from '../cli/commands/install';
import { runUninstall } from '../cli/commands/uninstall';
import { buildMcpConfig, localServerEntry } from '../cli/commands/mcpConfig';
import { editPlugin, editSetting, removeOwnedAutoloads } from '../cli/commands/projectSettings';

describe('Local installation contract', () => {
  test('configuration resolves this installed adapter, without npx or a consumer path', () => {
    const config = buildMcpConfig('/some game') as { servers: { godot: { command: string; args: string[]; env: { GODOT_PROJECT_ROOT: string } } } };
    expect(config.servers.godot.command).toBe(process.execPath);
    expect(config.servers.godot.args).toEqual([localServerEntry()]);
    expect(config.servers.godot.env.GODOT_PROJECT_ROOT).toBe(path.resolve('/some game'));
  });
  test('plugin edits are idempotent and preserve unrelated plugins and foreign autoloads', () => {
    const text = '[editor_plugins]\nenabled=PackedStringArray("res://addons/other/plugin.cfg")\n[autoload]\nGodotUniversalMcpRuntime="*res://foreign.gd"\n';
    const enabled = editPlugin(text, true);
    expect(editPlugin(enabled, true)).toBe(enabled);
    expect(removeOwnedAutoloads(enabled)).toContain('GodotUniversalMcpRuntime="*res://foreign.gd"');
    expect(editPlugin(enabled, false)).toContain('enabled=PackedStringArray("res://addons/other/plugin.cfg")');
    expect(() => editSetting('[x]\na=1\na=2', 'x', 'a', () => '3')).toThrow('Duplicate');
  });
  test('install, repeat install and uninstall preserve other client settings', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gumcp-install-'));
    try {
      await writeFile(path.join(root, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Fixture"\n');
      await mkdir(path.join(root, '.vscode'));
      await writeFile(path.join(root, '.vscode/mcp.json'), JSON.stringify({ servers: { other: { command: 'unrelated' } }, inputs: [] }));
      await runInstall(root, { enable: true, autoload: true });
      await runInstall(root, { enable: true, autoload: true });
      const project = await readFile(path.join(root, 'project.godot'), 'utf8');
      expect(project.match(/plugin\.cfg/g)).toHaveLength(1);
      expect(project).not.toContain('GodotUniversalMcpRuntime=');
      expect(project).toContain('runtime_enabled=true');
      const local = JSON.parse(await readFile(path.join(root, '.godot-universal-mcp/client.json'), 'utf8'));
      const vscode = JSON.parse(await readFile(path.join(root, '.vscode/mcp.json'), 'utf8'));
      expect(vscode.servers.other.command).toBe('unrelated');
      expect(vscode.servers.godot).toEqual(local.vscode.servers.godot);
      expect(await readdir(path.join(root, '.godot-universal-mcp/backups'))).toHaveLength(2);
      await runUninstall(root, { removeConfig: true });
      const after = JSON.parse(await readFile(path.join(root, '.vscode/mcp.json'), 'utf8'));
      expect(after.servers.other.command).toBe('unrelated');
      expect(after.servers.godot).toBeUndefined();
      expect(after.inputs).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test('invalid client JSON is not overwritten or partly installed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gumcp-bad-config-'));
    try {
      await writeFile(path.join(root, 'project.godot'), 'config_version=5\n');
      await mkdir(path.join(root, '.vscode'));
      const file = path.join(root, '.vscode/mcp.json');
      await writeFile(file, '{// keep my comment\n}');
      await expect(runInstall(root)).rejects.toThrow('Invalid JSON');
      expect(await readFile(file, 'utf8')).toBe('{// keep my comment\n}');
      expect(await readdir(root)).not.toContain('addons');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
