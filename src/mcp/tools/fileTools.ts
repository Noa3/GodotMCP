import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { jsonResult } from '../toolUtils';
import { ERROR_CODES } from '../../utils/errors';
import { isDeniedPath, resolveProjectPath } from '../../security/pathSafety';

function relativeProjectPath(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
}

async function ensureAllowedPath(context: McpRuntimeContext, inputPath: string): Promise<string> {
  const config = await context.getConfig();
  const resolved = resolveProjectPath(context.projectRoot, inputPath);
  if (isDeniedPath(relativeProjectPath(context.projectRoot, resolved), config.security.deniedPaths)) {
    throw new Error(`${ERROR_CODES.PATH_DENIED}: ${inputPath}`);
  }
  return resolved;
}

async function ensureWriteAccess(context: McpRuntimeContext, destructive = false): Promise<void> {
  const config = await context.getConfig();
  if (config.security.allowWrite && config.security.trustMode === 'trusted') {
    return;
  }
  throw new Error(`${destructive ? ERROR_CODES.DANGEROUS_TOOL_DISABLED : ERROR_CODES.WRITE_DISABLED}: write access is disabled`);
}

export function applyLinePatch(content: string, startLine: number, endLine: number, replacement: string): string {
  const lines = content.split(/\r?\n/);
  const before = lines.slice(0, Math.max(0, startLine - 1));
  const after = lines.slice(Math.max(0, endLine));
  const replacementLines = replacement.split(/\r?\n/);
  return [...before, ...replacementLines, ...after].join('\n');
}

export function getFileTools(context: McpRuntimeContext): ToolDefinition[] {
  return [
    {
      name: 'godot_file_read',
      title: 'Godot File Read',
      description: 'Read a text file inside the Godot project root.',
      schema: z.object({ path: z.string().min(1) }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: ['path'] },
      riskLevel: 'safe',
      execute: async ({ path: inputPath }) => {
        const absolutePath = await ensureAllowedPath(context, inputPath);
        return jsonResult({ path: relativeProjectPath(context.projectRoot, absolutePath), content: await readFile(absolutePath, 'utf8') });
      },
    },
    {
      name: 'godot_file_write',
      title: 'Godot File Write',
      description: 'Write a text file inside the Godot project root.',
      schema: z.object({ path: z.string().min(1), content: z.string(), createDirectories: z.boolean().optional() }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          createDirectories: { type: 'boolean' },
        },
        required: ['path', 'content'],
      },
      riskLevel: 'write',
      execute: async ({ path: inputPath, content, createDirectories }) => {
        await ensureWriteAccess(context);
        const absolutePath = await ensureAllowedPath(context, inputPath);
        if (createDirectories) {
          await mkdir(path.dirname(absolutePath), { recursive: true });
        }
        await writeFile(absolutePath, content, 'utf8');
        return jsonResult({ path: relativeProjectPath(context.projectRoot, absolutePath), bytesWritten: Buffer.byteLength(content, 'utf8') });
      },
    },
    {
      name: 'godot_file_patch',
      title: 'Godot File Patch',
      description: 'Apply a line-based patch to a text file.',
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
        const absolutePath = await ensureAllowedPath(context, inputPath);
        const content = await readFile(absolutePath, 'utf8');
        const patched = applyLinePatch(content, startLine, endLine, replacement);
        await writeFile(absolutePath, patched, 'utf8');
        return jsonResult({ path: relativeProjectPath(context.projectRoot, absolutePath), startLine, endLine });
      },
    },
    {
      name: 'godot_file_list',
      title: 'Godot File List',
      description: 'List files or directories in a project-relative folder.',
      schema: z.object({ path: z.string().default('.'), recursive: z.boolean().optional() }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string', default: '.' }, recursive: { type: 'boolean' } },
      },
      riskLevel: 'safe',
      execute: async ({ path: inputPath, recursive }) => {
        const absolutePath = await ensureAllowedPath(context, inputPath);
        if (recursive) {
          const { walkProject } = await import('../../utils/projectScanner');
          const config = await context.getConfig();
          const relativeRoot = relativeProjectPath(context.projectRoot, absolutePath);
          const walked = await walkProject({
            root: absolutePath,
            maxEntries: config.scan.maxFiles,
            includeDirectories: true,
          });
          return jsonResult({ root: relativeRoot || '.', entries: walked.entries, truncated: walked.truncated });
        }

        const directoryEntries = await readdir(absolutePath, { withFileTypes: true });
        const entries = directoryEntries
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }));
        return jsonResult({ root: relativeProjectPath(context.projectRoot, absolutePath) || '.', entries });
      },
    },
    {
      name: 'godot_file_move',
      title: 'Godot File Move',
      description: 'Move or rename a file inside the project.',
      schema: z.object({ from: z.string().min(1), to: z.string().min(1) }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
      riskLevel: 'write',
      execute: async ({ from, to }) => {
        await ensureWriteAccess(context);
        const source = await ensureAllowedPath(context, from);
        const target = await ensureAllowedPath(context, to);
        await mkdir(path.dirname(target), { recursive: true });
        await rename(source, target);
        return jsonResult({ from: relativeProjectPath(context.projectRoot, source), to: relativeProjectPath(context.projectRoot, target) });
      },
    },
    {
      name: 'godot_file_delete',
      title: 'Godot File Delete',
      description: 'Delete a file or directory inside the project.',
      schema: z.object({ path: z.string().min(1), recursive: z.boolean().optional() }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, recursive: { type: 'boolean' } },
        required: ['path'],
      },
      riskLevel: 'destructive',
      execute: async ({ path: inputPath, recursive }) => {
        await ensureWriteAccess(context, true);
        const absolutePath = await ensureAllowedPath(context, inputPath);
        await rm(absolutePath, { recursive: recursive ?? false, force: false });
        return jsonResult({ deleted: relativeProjectPath(context.projectRoot, absolutePath) });
      },
    },
  ];
}
