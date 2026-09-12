import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureProjectConfig, writeProjectConfig } from '../../config/project';
import { buildMcpConfig, localServerEntry, SERVER_KEY } from './mcpConfig';
import { assertLocalTarget, editPlugin, editSetting, projectDirectory, readJsonObject, writeWithBackup } from './projectSettings';

export interface InstallCommandOptions { enable?: boolean; autoload?: boolean; }

export async function runInstall(projectPath: string, options: InstallCommandOptions = {}): Promise<{ projectPath: string; nextSteps: string[] }> {
  const root = await projectDirectory(projectPath);
  const packageRoot = path.resolve(__dirname, '../../..');
  await stat(localServerEntry()); // Fail before modifying a project when npm run build was omitted.
  const source = path.join(packageRoot, 'addons/godot_universal_mcp');
  const destination = path.join(root, 'addons/godot_universal_mcp');
  if (source === destination) throw new Error('Source and destination addon directories must differ');
  const vscodeFile = path.join(root, '.vscode/mcp.json');
  const localDir = path.join(root, '.godot-universal-mcp');
  for (const target of [destination, vscodeFile, localDir]) await assertLocalTarget(root, target);
  const vscode = await readJsonObject(vscodeFile);
  if (vscode.servers !== undefined && (!vscode.servers || typeof vscode.servers !== 'object' || Array.isArray(vscode.servers))) throw new Error('Invalid servers object in .vscode/mcp.json');
  const generated = buildMcpConfig(root);
  const generatedServers = generated.servers as Record<string, unknown>;
  vscode.servers = { ...(vscode.servers as Record<string, unknown> | undefined), [SERVER_KEY]: generatedServers[SERVER_KEY] };
  const projectFile = path.join(root, 'project.godot');
  let projectText = await readFile(projectFile, 'utf8');
  // --autoload means opt in through the plugin, not a second autoload owner.
  if (options.enable || options.autoload) projectText = editPlugin(projectText, true);
  if (options.autoload) projectText = editSetting(projectText, 'godot_universal_mcp', 'runtime_enabled', () => 'true');
  projectText = editSetting(projectText, 'autoload', 'GodotUniversalMcpBridge', (value) => value === '"*res://addons/godot_universal_mcp/bridge.gd"' ? undefined : value);
  // Validate existing project configuration before copying anything.
  await readJsonObject(path.join(localDir, 'config.json'));
  try {
    await stat(destination);
    await cp(destination, `${destination}.gumcp-${randomUUID()}.bak`, { recursive: true, errorOnExist: true, force: false });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
  await mkdir(path.dirname(vscodeFile), { recursive: true });
  await mkdir(localDir, { recursive: true });
  await ensureProjectConfig(root);
  // Do not revoke or grant trust or reset addon flags on a plain reinstall.
  if (options.enable || options.autoload) {
    const addon: { enabled: boolean; autoload?: boolean } = { enabled: true };
    if (options.autoload) addon.autoload = true;
    await writeProjectConfig(root, { addon });
  }
  await writeWithBackup(projectFile, projectText);
  await writeWithBackup(vscodeFile, `${JSON.stringify(vscode, null, 2)}\n`);
  await writeFile(path.join(localDir, 'client.json'), `${JSON.stringify({ version: 1, projectRoot: root, vscode: generated, generic: buildMcpConfig(root, 'copilot-cli') }, null, 2)}\n`, 'utf8');
  return { projectPath: root, nextSteps: [
    'Open the project in Godot and enable Godot Universal MCP if needed.',
    'Use the generated .vscode/mcp.json, or Copy Config in the Godot dock.',
    'The dock owns runtime opt-in. Re-run install after moving this server or the project.',
    'Run doctor for diagnostics. Server write access remains disabled unless explicitly trusted.',
  ] };
}
