import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface UninstallCommandOptions {
  removeConfig?: boolean;
  removeAutoload?: boolean;
}

function removePluginSetting(content: string): string {
  return content
    .replace(/,?\s*"res:\/\/addons\/godot_universal_mcp\/plugin\.cfg"/g, '')
    .replace(/enabled=PackedStringArray\(\s*\)/g, 'enabled=PackedStringArray()');
}

function removeAutoloadSetting(content: string): string {
  return content.replace(/^GodotUniversalMcpBridge="\*res:\/\/addons\/godot_universal_mcp\/bridge\.gd"\n?/gm, '');
}

export async function runUninstall(projectPath: string, options: UninstallCommandOptions = {}): Promise<{ removed: string[] }> {
  const resolvedProjectPath = path.resolve(projectPath);
  const removed: string[] = [];

  await rm(path.join(resolvedProjectPath, 'addons', 'godot_universal_mcp'), { recursive: true, force: true });
  removed.push('addons/godot_universal_mcp');

  if (options.removeConfig) {
    await rm(path.join(resolvedProjectPath, '.godot-universal-mcp'), { recursive: true, force: true });
    await rm(path.join(resolvedProjectPath, '.vscode', 'mcp.json'), { force: true });
    removed.push('.godot-universal-mcp', '.vscode/mcp.json');
  }

  if (options.removeAutoload) {
    const projectFilePath = path.join(resolvedProjectPath, 'project.godot');
    let content = await readFile(projectFilePath, 'utf8');
    content = removePluginSetting(content);
    content = removeAutoloadSetting(content);
    await writeFile(projectFilePath, content, 'utf8');
    removed.push('project.godot settings');
  }

  return { removed };
}
