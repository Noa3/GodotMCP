import { copyFile, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureProjectConfig, writeProjectConfig } from '../../config/project';
import { formatMcpConfig } from './mcpConfig';

export interface InstallCommandOptions {
  enable?: boolean;
  autoload?: boolean;
}

function repoRoot(): string {
  return path.resolve(__dirname, '../../..');
}

async function assertProject(projectPath: string): Promise<void> {
  await stat(path.join(projectPath, 'project.godot'));
}

function injectPluginSetting(content: string): string {
  if (content.includes('enabled=PackedStringArray("res://addons/godot_universal_mcp/plugin.cfg")')) {
    return content;
  }
  const sectionRegex = /\[editor_plugins\][\s\S]*?(?=\n\[|$)/;
  if (sectionRegex.test(content)) {
    return content.replace(sectionRegex, (section) => {
      if (/enabled\s*=/.test(section)) {
        return section.replace(/enabled\s*=\s*PackedStringArray\(([^)]*)\)/, (_match, current) => {
          const trimmed = current.trim();
          const items = trimmed ? `${trimmed}, ` : '';
          return `enabled=PackedStringArray(${items}"res://addons/godot_universal_mcp/plugin.cfg")`;
        });
      }
      return `${section}\nenabled=PackedStringArray("res://addons/godot_universal_mcp/plugin.cfg")`;
    });
  }
  return `${content.trimEnd()}\n\n[editor_plugins]\nenabled=PackedStringArray("res://addons/godot_universal_mcp/plugin.cfg")\n`;
}

function injectAutoload(content: string): string {
  const key = 'GodotUniversalMcpBridge="*res://addons/godot_universal_mcp/bridge.gd"';
  if (content.includes(key)) {
    return content;
  }
  const sectionRegex = /\[autoload\][\s\S]*?(?=\n\[|$)/;
  if (sectionRegex.test(content)) {
    return content.replace(sectionRegex, (section) => `${section}\n${key}`);
  }
  return `${content.trimEnd()}\n\n[autoload]\n${key}\n`;
}

export async function runInstall(projectPath: string, options: InstallCommandOptions = {}): Promise<{ projectPath: string; nextSteps: string[] }> {
  const resolvedProjectPath = path.resolve(projectPath);
  await assertProject(resolvedProjectPath);

  const sourceAddonsPath = path.join(repoRoot(), 'addons');
  const destinationAddonsPath = path.join(resolvedProjectPath, 'addons');
  await mkdir(destinationAddonsPath, { recursive: true });
  await cp(sourceAddonsPath, destinationAddonsPath, { recursive: true });

  const vscodePath = path.join(resolvedProjectPath, '.vscode');
  await mkdir(vscodePath, { recursive: true });
  await writeFile(path.join(vscodePath, 'mcp.json'), formatMcpConfig(resolvedProjectPath, 'vscode'), 'utf8');

  await ensureProjectConfig(resolvedProjectPath);
  await writeProjectConfig(resolvedProjectPath, {
    addon: { enabled: Boolean(options.enable), autoload: Boolean(options.autoload) },
  });

  const projectFilePath = path.join(resolvedProjectPath, 'project.godot');
  const backupPath = `${projectFilePath}.bak`;
  await copyFile(projectFilePath, backupPath);
  let projectFileContent = await readFile(projectFilePath, 'utf8');
  if (options.enable) {
    projectFileContent = injectPluginSetting(projectFileContent);
  }
  if (options.autoload) {
    projectFileContent = injectAutoload(projectFileContent);
  }
  await writeFile(projectFilePath, projectFileContent, 'utf8');

  return {
    projectPath: resolvedProjectPath,
    nextSteps: [
      'Open the project in Godot 4.x.',
      'Enable the addon if it is not already enabled.',
      'Run `godot-universal-mcp doctor <projectPath>` to verify installation.',
    ],
  };
}
