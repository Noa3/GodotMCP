import { z } from 'zod';
import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { jsonResult, errorResult } from '../toolUtils';
import { bridgeErrorPayload } from '../../utils/errors';

async function callEditor(context: McpRuntimeContext, tool: string, params: Record<string, unknown> = {}) {
  const response = await context.editorClient.sendRequest(tool, params);
  return response.ok ? jsonResult(response.result) : errorResult(bridgeErrorPayload(response.error));
}

export function getEditorTools(context: McpRuntimeContext): ToolDefinition[] {
  const simple: Array<[string, string, string, 'safe' | 'write']> = [
    ['godot_editor_status', 'editor.get_status', 'Read engine version, project identity and language capabilities from the editor.', 'safe'],
    ['godot_editor_capabilities', 'editor.get_capabilities', 'Discover supported bridge operations and .NET availability; the addon itself needs no .NET.', 'safe'],
    ['godot_editor_save_all', 'editor.save_all', 'Request saving all open scenes. Requires trusted write access.', 'write'],
    ['godot_editor_filesystem_scan', 'editor.filesystem_scan', 'Request an editor filesystem scan.', 'safe'],
  ];
  return [
    ...simple.map(([name, command, description, riskLevel]): ToolDefinition => ({
      name, title: name.replace(/_/g, ' '), description, riskLevel, requiresEditor: true,
      schema: z.object({}), inputSchema: { type: 'object', additionalProperties: false },
      execute: async () => callEditor(context, command),
    })),
    {
      name: 'godot_editor_output', title: 'Godot Editor Output',
      description: 'Query editor log capture. Currently returns NOT_IMPLEMENTED rather than a misleading empty log.',
      schema: z.object({ limit: z.number().int().positive().max(500).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'number' } } },
      riskLevel: 'safe', requiresEditor: true,
      execute: async ({ limit }) => callEditor(context, 'editor.get_output', { limit }),
    },
    {
      name: 'godot_editor_tree', title: 'Godot Edited Scene Tree',
      description: 'Inspect the currently edited, possibly unsaved scene without instantiating scenes from disk. Paths are root-relative.',
      schema: z.object({ max_depth: z.number().int().min(0).max(12).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { max_depth: { type: 'integer' } } },
      riskLevel: 'safe', requiresEditor: true,
      execute: async (params) => callEditor(context, 'editor.get_scene_tree', params),
    },
    {
      name: 'godot_editor_get_node', title: 'Godot Edited Node',
      description: 'Read a node and stored properties, including GDScript or C# exports. Use . for the edited scene root.',
      schema: z.object({ node_path: z.string().min(1) }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { node_path: { type: 'string' } }, required: ['node_path'] },
      riskLevel: 'safe', requiresEditor: true,
      execute: async (params) => callEditor(context, 'editor.get_node', params),
    },
    {
      name: 'godot_editor_set_node_property', title: 'Godot Set Edited Node Property',
      description: 'Set a primitive, Vector2, Vector3 or Color property through editor Undo/Redo. Use root-relative node paths. No script/resource assignment.',
      schema: z.object({ node_path: z.string().min(1), property: z.string().min(1), value: z.unknown().refine((v) => v !== undefined, 'value is required') }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { node_path: { type: 'string' }, property: { type: 'string' }, value: {} }, required: ['node_path', 'property', 'value'] },
      riskLevel: 'write', requiresEditor: true,
      execute: async (params) => callEditor(context, 'editor.set_node_property', params),
    },
  ];
}
