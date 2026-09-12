import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertLocalTarget, editPlugin, editSetting, projectDirectory, readJsonObject, removeOwnedAutoloads, writeWithBackup } from './projectSettings';
import { SERVER_KEY } from './mcpConfig';

export interface UninstallCommandOptions { removeConfig?: boolean; removeAutoload?: boolean; }

export async function runUninstall(projectPath: string, options: UninstallCommandOptions = {}): Promise<{ removed: string[] }> {
  const root = await projectDirectory(projectPath);
  const projectFile = path.join(root, 'project.godot');
  const addon = path.join(root, 'addons/godot_universal_mcp');
  const localDir = path.join(root, '.godot-universal-mcp');
  const vscodeFile = path.join(root, '.vscode/mcp.json');
  for (const target of [addon, localDir, vscodeFile]) await assertLocalTarget(root, target);
  let text = removeOwnedAutoloads(editPlugin(await readFile(projectFile, 'utf8'), false));
  text = editSetting(text, 'godot_universal_mcp', 'runtime_enabled', () => 'false');
  const vscode = options.removeConfig ? await readJsonObject(vscodeFile) : undefined;
  // Always remove our references before deleting their files. The old flag remains CLI-compatible.
  await writeWithBackup(projectFile, text);
  await rm(addon, { recursive: true, force: true });
  const removed = ['addons/godot_universal_mcp', 'project.godot MCP settings'];
  if (options.removeConfig && vscode) {
    const servers = vscode.servers as Record<string, unknown> | undefined;
    if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
      const entry = servers[SERVER_KEY] as { env?: { GODOT_PROJECT_ROOT?: string } } | undefined;
      // Never remove a same-named server configured for another project.
      if (entry?.env?.GODOT_PROJECT_ROOT && path.resolve(entry.env.GODOT_PROJECT_ROOT) === root) {
        delete servers[SERVER_KEY];
        await writeWithBackup(vscodeFile, `${JSON.stringify(vscode, null, 2)}\n`);
        removed.push('.vscode/mcp.json MCP entry');
      }
    }
    await rm(localDir, { recursive: true, force: true });
    removed.push('.godot-universal-mcp');
  }
  return { removed };
}
