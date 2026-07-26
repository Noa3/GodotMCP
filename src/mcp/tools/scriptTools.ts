import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { jsonResult } from '../toolUtils';
import { ERROR_CODES } from '../../utils/errors';
import { isDeniedPath, resolveProjectPath } from '../../security/pathSafety';
import { loadGitignorePatterns, walkProject } from '../../utils/projectScanner';
import { applyLinePatch } from './fileTools';

async function ensureScriptPath(context: McpRuntimeContext, inputPath: string): Promise<string> {
  const config = await context.getConfig();
  const resolved = resolveProjectPath(context.projectRoot, inputPath);
  const relative = path.relative(context.projectRoot, resolved).replace(/\\/g, '/');
  if (!/\.(gd|cs)$/i.test(relative)) {
    throw new Error(`${ERROR_CODES.INVALID_PROJECT}: ${inputPath} is not a script path`);
  }
  if (isDeniedPath(relative, config.security.deniedPaths)) {
    throw new Error(`${ERROR_CODES.PATH_DENIED}: ${inputPath}`);
  }
  return resolved;
}

async function ensureWriteAccess(context: McpRuntimeContext): Promise<void> {
  const config = await context.getConfig();
  if (!(config.security.allowWrite && config.security.trustMode === 'trusted')) {
    throw new Error(`${ERROR_CODES.WRITE_DISABLED}: script write tools are disabled`);
  }
}

function extractSymbols(content: string): Record<string, string[]> {
  return {
    classNames: [...content.matchAll(/^\s*class_name\s+(\w+)/gm)].map((match) => match[1]),
    functions: [...content.matchAll(/^\s*func\s+(\w+)/gm)].map((match) => match[1]),
    variables: [...content.matchAll(/^\s*(?:@export\s+)?var\s+(\w+)/gm)].map((match) => match[1]),
    constants: [...content.matchAll(/^\s*const\s+(\w+)/gm)].map((match) => match[1]),
    signals: [...content.matchAll(/^\s*signal\s+(\w+)/gm)].map((match) => match[1]),
  };
}

export function getScriptTools(context: McpRuntimeContext): ToolDefinition[] {
  return [
    {
      name: 'godot_script_list',
      title: 'Godot Script List',
      description: 'List all .gd and .cs scripts in the project.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'safe',
      execute: async () => {
        const config = await context.getConfig();
        const ignorePatterns = [...config.scan.ignore, ...(await loadGitignorePatterns(context.projectRoot))];
        const tree = await walkProject({ root: context.projectRoot, ignorePatterns, maxEntries: config.scan.maxFiles });
        return jsonResult({ scripts: tree.entries.filter((entry) => entry.type === 'file' && /\.(gd|cs)$/i.test(entry.path)).map((entry) => entry.path), truncated: tree.truncated });
      },
    },
    {
      name: 'godot_script_read',
      title: 'Godot Script Read',
      description: 'Read a GDScript or C# script file.',
      schema: z.object({ path: z.string().min(1) }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: ['path'] },
      riskLevel: 'safe',
      execute: async ({ path: inputPath }) => {
        const absolutePath = await ensureScriptPath(context, inputPath);
        return jsonResult({ path: path.relative(context.projectRoot, absolutePath).replace(/\\/g, '/'), content: await readFile(absolutePath, 'utf8') });
      },
    },
    {
      name: 'godot_script_create',
      title: 'Godot Script Create',
      description: 'Create a new GDScript file from template parts.',
      schema: z.object({ path: z.string().min(1), extends: z.string().default('Node'), className: z.string().optional(), body: z.string().optional() }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          extends: { type: 'string', default: 'Node' },
          className: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['path'],
      },
      riskLevel: 'write',
      execute: async ({ path: inputPath, extends: extendsType, className, body }) => {
        await ensureWriteAccess(context);
        const absolutePath = await ensureScriptPath(context, inputPath);
        const lines = [`extends ${extendsType}`];
        if (className) {
          lines.push('', `class_name ${className}`);
        }
        lines.push('', body ?? 'func _ready() -> void:\n\tpass');
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, `${lines.join('\n')}\n`, 'utf8');
        return jsonResult({ created: path.relative(context.projectRoot, absolutePath).replace(/\\/g, '/') });
      },
    },
    {
      name: 'godot_script_patch',
      title: 'Godot Script Patch',
      description: 'Apply a line-based patch to a script file.',
      schema: z.object({ path: z.string().min(1), startLine: z.number().int().positive(), endLine: z.number().int().positive(), replacement: z.string() }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          startLine: { type: 'number' },
          endLine: { type: 'number' },
          replacement: { type: 'string' },
        },
        required: ['path', 'startLine', 'endLine', 'replacement'],
      },
      riskLevel: 'write',
      execute: async ({ path: inputPath, startLine, endLine, replacement }) => {
        await ensureWriteAccess(context);
        const absolutePath = await ensureScriptPath(context, inputPath);
        const content = await readFile(absolutePath, 'utf8');
        await writeFile(absolutePath, applyLinePatch(content, startLine, endLine, replacement), 'utf8');
        return jsonResult({ patched: path.relative(context.projectRoot, absolutePath).replace(/\\/g, '/'), startLine, endLine });
      },
    },
    {
      name: 'godot_script_symbols',
      title: 'Godot Script Symbols',
      description: 'Extract class, function, signal and variable names from a script.',
      schema: z.object({ path: z.string().min(1) }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: ['path'] },
      riskLevel: 'safe',
      execute: async ({ path: inputPath }) => {
        const absolutePath = await ensureScriptPath(context, inputPath);
        return jsonResult(extractSymbols(await readFile(absolutePath, 'utf8')));
      },
    },
    {
      name: 'godot_script_todo_index',
      title: 'Godot Script TODO Index',
      description: 'Find TODO, FIXME and HACK comments in scripts.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'safe',
      execute: async () => {
        const config = await context.getConfig();
        const ignorePatterns = [...config.scan.ignore, ...(await loadGitignorePatterns(context.projectRoot))];
        const tree = await walkProject({ root: context.projectRoot, ignorePatterns, maxEntries: config.scan.maxFiles });
        const items: Array<{ path: string; line: number; text: string }> = [];
        for (const entry of tree.entries) {
          if (entry.type !== 'file' || !/\.(gd|cs)$/i.test(entry.path)) {
            continue;
          }
          const content = await readFile(path.join(context.projectRoot, entry.path), 'utf8');
          content.split(/\r?\n/).forEach((line, index) => {
            if (/#|\/\//.test(line) && /\b(TODO|FIXME|HACK)\b/.test(line)) {
              items.push({ path: entry.path, line: index + 1, text: line.trim() });
            }
          });
        }
        return jsonResult({ items, truncated: tree.truncated });
      },
    },
  ];
}
