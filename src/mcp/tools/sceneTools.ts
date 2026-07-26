import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { jsonResult, errorResult } from '../toolUtils';
import { createErrorPayload, ERROR_CODES } from '../../utils/errors';
import { isDeniedPath, resolveProjectPath } from '../../security/pathSafety';
import { loadGitignorePatterns, walkProject } from '../../utils/projectScanner';

interface SceneSection {
  header: string;
  attributes: Record<string, string>;
  startLine: number;
  endLine: number;
  lines: string[];
}

interface SceneNode {
  name: string;
  type?: string;
  instance?: string;
  parent?: string;
  path: string;
  properties: Record<string, string>;
  children: SceneNode[];
}

interface ParsedScene {
  header: SceneSection | null;
  extResources: SceneSection[];
  subResources: SceneSection[];
  nodes: SceneNode[];
  sections: SceneSection[];
  issues: string[];
}

function parseAttributes(rawHeader: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex = /(\w+)=("[^"]*"|[^\s]+)/g;
  let match = regex.exec(rawHeader);
  while (match) {
    attributes[match[1]] = match[2].replace(/^"|"$/g, '');
    match = regex.exec(rawHeader);
  }
  return attributes;
}

function parseScene(content: string): ParsedScene {
  const lines = content.split(/\r?\n/);
  const sections: SceneSection[] = [];
  let current: SceneSection | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (current) {
        current.endLine = index;
        sections.push(current);
      }
      const body = trimmed.slice(1, -1);
      const [header] = body.split(/\s+/, 1);
      current = {
        header,
        attributes: parseAttributes(body),
        startLine: index + 1,
        endLine: index + 1,
        lines: [line],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    current.endLine = lines.length;
    sections.push(current);
  }

  const issues: string[] = [];
  const header = sections.find((section) => section.header === 'gd_scene') ?? null;
  if (!header) {
    issues.push('Missing [gd_scene] header');
  }

  const extResources = sections.filter((section) => section.header === 'ext_resource');
  const subResources = sections.filter((section) => section.header === 'sub_resource');
  const nodeSections = sections.filter((section) => section.header === 'node');
  const nodes: SceneNode[] = [];
  const pathToNode = new Map<string, SceneNode>();
  let rootPath = '';

  nodeSections.forEach((section) => {
    const properties: Record<string, string> = {};
    for (const propertyLine of section.lines.slice(1)) {
      const separator = propertyLine.indexOf('=');
      if (separator > 0) {
        properties[propertyLine.slice(0, separator).trim()] = propertyLine.slice(separator + 1).trim();
      }
    }

    const name = section.attributes.name ?? 'Unnamed';
    const parent = section.attributes.parent;
    let relativePath = name;
    if (!parent) {
      rootPath = name;
      relativePath = name;
    } else if (parent === '.') {
      relativePath = rootPath ? `${rootPath}/${name}` : name;
    } else {
      relativePath = `${parent}/${name}`.replace(/^\.\//, '');
    }

    const node: SceneNode = {
      name,
      type: section.attributes.type,
      instance: section.attributes.instance,
      parent,
      path: `/${relativePath}`,
      properties,
      children: [],
    };
    pathToNode.set(node.path, node);
    if (!parent) {
      nodes.push(node);
    } else {
      const parentPath = parent === '.' ? `/${rootPath}` : `/${parent}`;
      pathToNode.get(parentPath)?.children.push(node);
      if (!pathToNode.get(parentPath)) {
        issues.push(`Missing parent node for ${node.path}: ${parent}`);
        nodes.push(node);
      }
    }
  });

  return { header, extResources, subResources, nodes, sections, issues };
}

function flattenNodes(nodes: SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

async function ensureScenePath(context: McpRuntimeContext, inputPath: string): Promise<string> {
  const config = await context.getConfig();
  const resolved = resolveProjectPath(context.projectRoot, inputPath);
  const relative = path.relative(context.projectRoot, resolved).replace(/\\/g, '/');
  if (!relative.endsWith('.tscn')) {
    throw new Error(`${ERROR_CODES.INVALID_PROJECT}: ${inputPath} is not a .tscn file`);
  }
  if (isDeniedPath(relative, config.security.deniedPaths)) {
    throw new Error(`${ERROR_CODES.PATH_DENIED}: ${inputPath}`);
  }
  return resolved;
}

async function ensureWriteAccess(context: McpRuntimeContext): Promise<void> {
  const config = await context.getConfig();
  if (!(config.security.allowWrite && config.security.trustMode === 'trusted')) {
    throw new Error(`${ERROR_CODES.WRITE_DISABLED}: scene write tools are disabled`);
  }
}

function findBrokenReferences(parsed: ParsedScene, sceneFilePath: string, projectRoot: string): Array<{ kind: string; reference: string; reason: string }> {
  const broken: Array<{ kind: string; reference: string; reason: string }> = [];
  const extIds = new Set(parsed.extResources.map((section) => section.attributes.id).filter(Boolean));
  const subIds = new Set(parsed.subResources.map((section) => section.attributes.id).filter(Boolean));
  const extPaths = parsed.extResources.map((section) => section.attributes.path).filter(Boolean);

  extPaths.forEach((resourcePath) => {
    if (!resourcePath.startsWith('res://')) {
      return;
    }
    const absolutePath = path.join(projectRoot, resourcePath.replace(/^res:\/\//, ''));
    broken.push({ kind: 'resource_path', reference: resourcePath, reason: absolutePath === sceneFilePath ? 'self-reference' : 'unchecked' });
  });

  flattenNodes(parsed.nodes).forEach((node) => {
    Object.values(node.properties).forEach((value) => {
      const extMatch = value.match(/ExtResource\("([^"]+)"\)/);
      if (extMatch && !extIds.has(extMatch[1])) {
        broken.push({ kind: 'ExtResource', reference: extMatch[1], reason: `Missing ext_resource id in ${node.path}` });
      }
      const subMatch = value.match(/SubResource\("([^"]+)"\)/);
      if (subMatch && !subIds.has(subMatch[1])) {
        broken.push({ kind: 'SubResource', reference: subMatch[1], reason: `Missing sub_resource id in ${node.path}` });
      }
    });
  });

  return broken.filter((entry) => entry.reason !== 'unchecked');
}

export function getSceneTools(context: McpRuntimeContext): ToolDefinition[] {
  return [
    {
      name: 'godot_scene_list',
      title: 'Godot Scene List',
      description: 'List all .tscn scene files in the project.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'safe',
      execute: async () => {
        const config = await context.getConfig();
        const ignorePatterns = [...config.scan.ignore, ...(await loadGitignorePatterns(context.projectRoot))];
        const tree = await walkProject({ root: context.projectRoot, ignorePatterns, maxEntries: config.scan.maxFiles });
        return jsonResult({ scenes: tree.entries.filter((entry) => entry.type === 'file' && entry.path.endsWith('.tscn')).map((entry) => entry.path), truncated: tree.truncated });
      },
    },
    {
      name: 'godot_scene_get_tree',
      title: 'Godot Scene Get Tree',
      description: 'Parse a .tscn file and return its node tree.',
      schema: z.object({ path: z.string().min(1) }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: ['path'] },
      riskLevel: 'safe',
      execute: async ({ path: inputPath }) => {
        const absolutePath = await ensureScenePath(context, inputPath);
        const parsed = parseScene(await readFile(absolutePath, 'utf8'));
        return jsonResult({ path: path.relative(context.projectRoot, absolutePath).replace(/\\/g, '/'), nodes: parsed.nodes, issues: parsed.issues });
      },
    },
    {
      name: 'godot_scene_get_node',
      title: 'Godot Scene Get Node',
      description: 'Get a scene node by its path from a .tscn file.',
      schema: z.object({ path: z.string().min(1), nodePath: z.string().min(1) }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, nodePath: { type: 'string' } },
        required: ['path', 'nodePath'],
      },
      riskLevel: 'safe',
      execute: async ({ path: inputPath, nodePath }) => {
        const absolutePath = await ensureScenePath(context, inputPath);
        const parsed = parseScene(await readFile(absolutePath, 'utf8'));
        const normalizedNodePath = nodePath.startsWith('/') ? nodePath : `/${nodePath.replace(/^\//, '')}`;
        const node = flattenNodes(parsed.nodes).find((entry) => entry.path === normalizedNodePath);
        if (!node) {
          return errorResult(createErrorPayload(ERROR_CODES.INVALID_PROJECT, `Node not found: ${nodePath}`));
        }
        return jsonResult(node);
      },
    },
    {
      name: 'godot_scene_set_node_property',
      title: 'Godot Scene Set Node Property',
      description: 'Set a node property in a .tscn file.',
      schema: z.object({ path: z.string().min(1), nodePath: z.string().min(1), property: z.string().min(1), value: z.string() }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          nodePath: { type: 'string' },
          property: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['path', 'nodePath', 'property', 'value'],
      },
      riskLevel: 'write',
      execute: async ({ path: inputPath, nodePath, property, value }) => {
        await ensureWriteAccess(context);
        const absolutePath = await ensureScenePath(context, inputPath);
        const content = await readFile(absolutePath, 'utf8');
        const parsed = parseScene(content);
        const node = flattenNodes(parsed.nodes).find((entry) => entry.path === (nodePath.startsWith('/') ? nodePath : `/${nodePath}`));
        if (!node) {
          return errorResult(createErrorPayload(ERROR_CODES.INVALID_PROJECT, `Node not found: ${nodePath}`));
        }
        const section = parsed.sections.find((candidate) => candidate.header === 'node' && candidate.attributes.name === node.name && `/${candidate.attributes.parent ? `${candidate.attributes.parent}/${candidate.attributes.name}`.replace(/^\.\//, '') : candidate.attributes.name}` === node.path);
        if (!section) {
          return errorResult(createErrorPayload(ERROR_CODES.INTERNAL_ERROR, `Unable to locate section for node ${nodePath}`));
        }
        const lines = content.split(/\r?\n/);
        let inserted = false;
        for (let index = section.startLine; index < section.endLine; index += 1) {
          const line = lines[index];
          if (line?.trim().startsWith(`${property} =`)) {
            lines[index] = `${property} = ${value}`;
            inserted = true;
            break;
          }
        }
        if (!inserted) {
          lines.splice(section.endLine, 0, `${property} = ${value}`);
        }
        await writeFile(absolutePath, `${lines.join('\n')}\n`, 'utf8');
        return jsonResult({ path: inputPath, nodePath, property, value });
      },
    },
    {
      name: 'godot_scene_validate',
      title: 'Godot Scene Validate',
      description: 'Validate a .tscn file structure.',
      schema: z.object({ path: z.string().min(1) }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: ['path'] },
      riskLevel: 'safe',
      execute: async ({ path: inputPath }) => {
        const absolutePath = await ensureScenePath(context, inputPath);
        const parsed = parseScene(await readFile(absolutePath, 'utf8'));
        return jsonResult({ valid: parsed.issues.length === 0, issues: parsed.issues, nodeCount: flattenNodes(parsed.nodes).length });
      },
    },
    {
      name: 'godot_scene_find_broken_references',
      title: 'Godot Scene Broken References',
      description: 'Find broken scene resource references.',
      schema: z.object({ path: z.string().min(1) }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } }, required: ['path'] },
      riskLevel: 'safe',
      execute: async ({ path: inputPath }) => {
        const absolutePath = await ensureScenePath(context, inputPath);
        const parsed = parseScene(await readFile(absolutePath, 'utf8'));
        return jsonResult({ brokenReferences: findBrokenReferences(parsed, absolutePath, context.projectRoot) });
      },
    },
  ];
}
