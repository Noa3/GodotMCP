import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { jsonResult, errorResult } from '../toolUtils';
import { createErrorPayload, ERROR_CODES } from '../../utils/errors';
import { loadGitignorePatterns, walkProject } from '../../utils/projectScanner';

export interface ProjectInfo {
  name: string | null;
  version: string | null;
  features: string[];
  raw: Record<string, string>;
}

function parseProjectGodotContent(content: string): ProjectInfo {
  const raw: Record<string, string> = {};
  let currentSection = '';
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"|"$/g, '');
    raw[currentSection ? `${currentSection}.${key}` : key] = value;
  }

  const featuresRaw = raw['application.config/features'] ?? raw['application.config.features'] ?? raw['application.features'] ?? '';
  return {
    name: raw['application.config/name'] ?? raw['application.config.name'] ?? null,
    version: raw['application.config/version'] ?? raw['application.config.version'] ?? null,
    features: featuresRaw
      .replace(/[[\]"]+/g, '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    raw,
  };
}

export async function readProjectInfo(projectRoot: string): Promise<ProjectInfo> {
  const content = await readFile(path.join(projectRoot, 'project.godot'), 'utf8');
  return parseProjectGodotContent(content);
}

async function getIgnorePatterns(context: McpRuntimeContext): Promise<string[]> {
  const config = await context.getConfig();
  const gitignorePatterns = await loadGitignorePatterns(context.projectRoot);
  return [...config.scan.ignore, ...gitignorePatterns];
}

async function scanProject(projectRoot: string, ignorePatterns: string[], maxFiles: number): Promise<{ scenes: string[]; scripts: string[]; resources: string[]; truncated: boolean }> {
  const walk = await walkProject({ root: projectRoot, ignorePatterns, maxEntries: maxFiles });
  const scenes: string[] = [];
  const scripts: string[] = [];
  const resources: string[] = [];
  for (const entry of walk.entries) {
    if (entry.type !== 'file') {
      continue;
    }
    if (entry.path.endsWith('.tscn')) {
      scenes.push(entry.path);
    } else if (entry.path.endsWith('.gd') || entry.path.endsWith('.cs')) {
      scripts.push(entry.path);
    } else if (/\.(tres|res|material|shader|gdshader|png|jpg|jpeg|wav|ogg)$/i.test(entry.path)) {
      resources.push(entry.path);
    }
  }
  return { scenes, scripts, resources, truncated: walk.truncated };
}

async function readTextFileIfSafe(filePath: string, sizeLimit: number): Promise<string | null> {
  const content = await readFile(filePath, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > sizeLimit) {
    return null;
  }
  return content;
}

export function getProjectTools(context: McpRuntimeContext): ToolDefinition[] {
  return [
    {
      name: 'godot_project_info',
      title: 'Godot Project Info',
      description: 'Read project.godot and summarize the project name, version and features.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'safe',
      execute: async () => {
        try {
          return jsonResult(await readProjectInfo(context.projectRoot));
        } catch (error) {
          return errorResult(createErrorPayload(ERROR_CODES.PROJECT_NOT_FOUND, 'Unable to read project.godot', {
            projectRoot: context.projectRoot,
            reason: error instanceof Error ? error.message : 'unknown',
          }));
        }
      },
    },
    {
      name: 'godot_project_tree',
      title: 'Godot Project Tree',
      description: 'List the project tree with ignore support and truncation details.',
      schema: z.object({ maxEntries: z.number().int().positive().max(5000).optional(), maxDepth: z.number().int().nonnegative().max(20).optional() }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          maxEntries: { type: 'number', description: 'Maximum number of entries to return.' },
          maxDepth: { type: 'number', description: 'Maximum directory depth to traverse.' },
        },
      },
      riskLevel: 'safe',
      execute: async ({ maxEntries, maxDepth }) => {
        const config = await context.getConfig();
        const ignorePatterns = await getIgnorePatterns(context);
        const tree = await walkProject({
          root: context.projectRoot,
          ignorePatterns,
          maxEntries: maxEntries ?? config.scan.maxFiles,
          maxDepth,
          includeDirectories: true,
        });
        return jsonResult(tree);
      },
    },
    {
      name: 'godot_project_scan',
      title: 'Godot Project Scan',
      description: 'Scan the project for scenes, scripts and resources.',
      schema: z.object({ maxEntries: z.number().int().positive().max(5000).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { maxEntries: { type: 'number' } } },
      riskLevel: 'safe',
      execute: async ({ maxEntries }) => {
        const config = await context.getConfig();
        const ignorePatterns = await getIgnorePatterns(context);
        return jsonResult(await scanProject(context.projectRoot, ignorePatterns, maxEntries ?? config.scan.maxFiles));
      },
    },
    {
      name: 'godot_project_doctor',
      title: 'Godot Project Doctor',
      description: 'Run health checks against the project installation and bridge connectivity.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'safe',
      execute: async () => {
        const { collectDoctorReport } = await import('../../cli/commands/doctor');
        return jsonResult(await collectDoctorReport(context.projectRoot));
      },
    },
    {
      name: 'godot_project_search',
      title: 'Godot Project Search',
      description: 'Search project files for plain text.',
      schema: z.object({ query: z.string().min(1), maxMatches: z.number().int().positive().max(200).optional() }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
          maxMatches: { type: 'number' },
        },
        required: ['query'],
      },
      riskLevel: 'safe',
      execute: async ({ query, maxMatches }) => {
        const config = await context.getConfig();
        const ignorePatterns = await getIgnorePatterns(context);
        const files = await walkProject({ root: context.projectRoot, ignorePatterns, maxEntries: config.scan.maxFiles });
        const matches: Array<{ path: string; line: number; text: string }> = [];
        const limit = maxMatches ?? 50;

        for (const entry of files.entries) {
          if (entry.type !== 'file') {
            continue;
          }
          const absolutePath = path.join(context.projectRoot, entry.path);
          const content = await readTextFileIfSafe(absolutePath, config.scan.maxFileSizeBytes);
          if (content === null) {
            continue;
          }
          const lines = content.split(/\r?\n/);
          lines.forEach((line, index) => {
            if (line.includes(query) && matches.length < limit) {
              matches.push({ path: entry.path, line: index + 1, text: line.trim() });
            }
          });
          if (matches.length >= limit) {
            break;
          }
        }

        return jsonResult({ query, matches, truncated: matches.length >= limit });
      },
    },
    {
      name: 'godot_project_grep',
      title: 'Godot Project Grep',
      description: 'Search project files using a regular expression.',
      schema: z.object({ pattern: z.string().min(1), flags: z.string().optional(), maxMatches: z.number().int().positive().max(200).optional() }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pattern: { type: 'string' },
          flags: { type: 'string' },
          maxMatches: { type: 'number' },
        },
        required: ['pattern'],
      },
      riskLevel: 'safe',
      execute: async ({ pattern, flags, maxMatches }) => {
        const config = await context.getConfig();
        const ignorePatterns = await getIgnorePatterns(context);
        const regex = new RegExp(pattern, flags);
        const files = await walkProject({ root: context.projectRoot, ignorePatterns, maxEntries: config.scan.maxFiles });
        const matches: Array<{ path: string; line: number; text: string }> = [];
        const limit = maxMatches ?? 50;

        for (const entry of files.entries) {
          if (entry.type !== 'file') {
            continue;
          }
          const absolutePath = path.join(context.projectRoot, entry.path);
          const content = await readTextFileIfSafe(absolutePath, config.scan.maxFileSizeBytes);
          if (content === null) {
            continue;
          }
          const lines = content.split(/\r?\n/);
          lines.forEach((line, index) => {
            if (regex.test(line) && matches.length < limit) {
              matches.push({ path: entry.path, line: index + 1, text: line.trim() });
            }
            regex.lastIndex = 0;
          });
          if (matches.length >= limit) {
            break;
          }
        }

        return jsonResult({ pattern, flags: flags ?? '', matches, truncated: matches.length >= limit });
      },
    },
  ];
}
