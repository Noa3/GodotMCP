import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { McpRuntimeContext } from '../context';
import type { ToolRegistry } from '../toolRegistry';
import { loadGitignorePatterns, walkProject } from '../../utils/projectScanner';
import { readProjectInfo } from '../tools/projectTools';

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: () => Promise<string>;
}

export async function buildResourceDefinitions(context: McpRuntimeContext, registry: ToolRegistry): Promise<ResourceDefinition[]> {
  const config = await context.getConfig();
  const ignorePatterns = [...config.scan.ignore, ...(await loadGitignorePatterns(context.projectRoot))];

  return [
    {
      uri: 'godot://project/summary',
      name: 'Godot Project Summary',
      description: 'High level summary of the current Godot project.',
      mimeType: 'application/json',
      read: async () => JSON.stringify(await readProjectInfo(context.projectRoot), null, 2),
    },
    {
      uri: 'godot://project/settings',
      name: 'Godot Project Settings',
      description: 'Raw project.godot settings file.',
      mimeType: 'text/plain',
      read: async () => readFile(path.join(context.projectRoot, 'project.godot'), 'utf8'),
    },
    {
      uri: 'godot://project/files',
      name: 'Godot Project Files',
      description: 'Project file tree snapshot.',
      mimeType: 'application/json',
      read: async () => JSON.stringify(await walkProject({ root: context.projectRoot, ignorePatterns, maxEntries: config.scan.maxFiles, includeDirectories: true }), null, 2),
    },
    {
      uri: 'godot://project/scenes',
      name: 'Godot Project Scenes',
      description: 'List of scene files in the project.',
      mimeType: 'application/json',
      read: async () => {
        const tree = await walkProject({ root: context.projectRoot, ignorePatterns, maxEntries: config.scan.maxFiles });
        return JSON.stringify(tree.entries.filter((entry) => entry.type === 'file' && entry.path.endsWith('.tscn')).map((entry) => entry.path), null, 2);
      },
    },
    {
      uri: 'godot://project/scripts',
      name: 'Godot Project Scripts',
      description: 'List of script files in the project.',
      mimeType: 'application/json',
      read: async () => {
        const tree = await walkProject({ root: context.projectRoot, ignorePatterns, maxEntries: config.scan.maxFiles });
        return JSON.stringify(tree.entries.filter((entry) => entry.type === 'file' && /\.(gd|cs)$/i.test(entry.path)).map((entry) => entry.path), null, 2);
      },
    },
    {
      uri: 'godot://project/errors',
      name: 'Godot Project Errors',
      description: 'Doctor report and recent connectivity status.',
      mimeType: 'application/json',
      read: async () => {
        const { collectDoctorReport } = await import('../../cli/commands/doctor');
        return JSON.stringify(await collectDoctorReport(context.projectRoot), null, 2);
      },
    },
    {
      uri: 'godot://docs/tool-index',
      name: 'Godot Tool Index',
      description: 'Index of available Godot MCP tools.',
      mimeType: 'application/json',
      read: async () => JSON.stringify(registry.list().map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        riskLevel: tool.riskLevel,
        requiresEditor: Boolean(tool.requiresEditor),
        requiresRuntime: Boolean(tool.requiresRuntime),
      })), null, 2),
    },
  ];
}
