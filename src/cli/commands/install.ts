import { cp, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureProjectConfig, writeProjectConfig } from '../../config/project';
import { buildMcpConfig, localServerEntry, SERVER_KEY } from './mcpConfig';
import { assertLocalTarget, editPlugin, editSetting, projectDirectory, readJsonObject, writeWithBackup } from './projectSettings';

export interface InstallCommandOptions { enable?: boolean; autoload?: boolean; }

export async function runInstall(projectPath: string, options: InstallCommandOptions = {}): Promise<{ projectPath: string; nextSteps: string[] }> {
  const root = await projectDirectory(projectPath);
  const packageRoot = path.resolve(__dirname, '../../..');
  await stat(localServerEntry());
  const source = path.join(packageRoot, 'addons/godot_universal_mcp');
  const destination = path.join(root, 'addons/godot_universal_mcp');
  if (source === destination) throw new Error('Source and destination addon directories must differ');
  const vscodeFile = path.join(root, '.vscode/mcp.json');
  const localDir = path.join(root, '.godot-universal-mcp');
  const operation = path.join(localDir, 'backups', randomUUID());
  const stage = path.join(operation, 'new-addon');
  const backup = path.join(operation, 'previous-addon');
  for (const target of [destination, vscodeFile, operation, path.join(localDir, '.gdignore'), path.join(localDir, 'config.json'), path.join(localDir, 'client.json')]) await assertLocalTarget(root, target);
  const vscode = await readJsonObject(vscodeFile);
  if (vscode.servers !== undefined && (!vscode.servers || typeof vscode.servers !== 'object' || Array.isArray(vscode.servers))) throw new Error('Invalid servers object in .vscode/mcp.json');
  const generated = buildMcpConfig(root);
  const generatedServers = generated.servers as Record<string, unknown>;
  vscode.servers = { ...(vscode.servers as Record<string, unknown> | undefined), [SERVER_KEY]: generatedServers[SERVER_KEY] };
  const projectFile = path.join(root, 'project.godot');
  let projectText = await readFile(projectFile, 'utf8');
  // Runtime autoload registration belongs exclusively to the plugin.
  if (options.enable || options.autoload) projectText = editPlugin(projectText, true);
  if (options.autoload) projectText = editSetting(projectText, 'godot_universal_mcp', 'runtime_enabled', () => 'true');
  projectText = editSetting(projectText, 'autoload', 'GodotUniversalMcpBridge', (value) => value === '"*res://addons/godot_universal_mcp/bridge.gd"' ? undefined : value);
  await readJsonObject(path.join(localDir, 'config.json'));
  await mkdir(operation, { recursive: true });
  await writeFile(path.join(localDir, '.gdignore'), '', 'utf8');
  await cp(source, stage, { recursive: true });
  await mkdir(path.dirname(destination), { recursive: true });
  let backedUp = false;
  try {
    await rename(destination, backup);
    backedUp = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try { await rename(stage, destination); }
  catch (error) { if (backedUp) await rename(backup, destination); throw error; }
  await mkdir(path.dirname(vscodeFile), { recursive: true });
  await ensureProjectConfig(root);
  if (options.enable || options.autoload) {
    const addon: { enabled: boolean; autoload?: boolean } = { enabled: true };
    if (options.autoload) addon.autoload = true;
    await writeProjectConfig(root, { addon });
  }
  await writeWithBackup(projectFile, projectText);
  await writeWithBackup(vscodeFile, `${JSON.stringify(vscode, null, 2)}\n`);
  await writeWithBackup(path.join(localDir, 'client.json'), `${JSON.stringify({ version: 1, projectRoot: root, vscode: generated, generic: buildMcpConfig(root, 'copilot-cli') }, null, 2)}\n`);
  return { projectPath: root, nextSteps: [
    'Open the project in Godot and enable Godot Universal MCP if needed.',
    'Use .vscode/mcp.json, or Copy Config in the Godot dock.',
    'The plugin owns runtime opt-in. Re-run install after moving this server or the project.',
    'Run doctor for diagnostics. Write access is disabled unless explicitly trusted.',
  ] };
}
