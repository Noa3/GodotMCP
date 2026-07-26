import { z } from 'zod';
import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { jsonResult, errorResult } from '../toolUtils';
import { createErrorPayload, ERROR_CODES } from '../../utils/errors';

async function callEditor(context: McpRuntimeContext, tool: string, params: Record<string, unknown> = {}) {
  const response = await context.editorClient.sendRequest(tool, params);
  if (!response.ok) {
    return errorResult(createErrorPayload(ERROR_CODES.GODOT_NOT_CONNECTED, response.error?.message ?? 'Godot editor is not connected', response.error?.details ?? context.editorClient.getStatus()));
  }
  return jsonResult(response.result);
}

export function getEditorTools(context: McpRuntimeContext): ToolDefinition[] {
  return [
    {
      name: 'godot_editor_status',
      title: 'Godot Editor Status',
      description: 'Check whether the Godot editor bridge is connected.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'safe',
      requiresEditor: true,
      execute: async () => jsonResult(context.editorClient.getStatus()),
    },
    {
      name: 'godot_editor_output',
      title: 'Godot Editor Output',
      description: 'Fetch recent editor console output through the bridge.',
      schema: z.object({ limit: z.number().int().positive().max(500).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'number' } } },
      riskLevel: 'safe',
      requiresEditor: true,
      execute: async ({ limit }) => callEditor(context, 'editor_output', { limit }),
    },
    {
      name: 'godot_editor_save_all',
      title: 'Godot Editor Save All',
      description: 'Tell the Godot editor to save all modified resources.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'write',
      requiresEditor: true,
      execute: async () => callEditor(context, 'editor_save_all'),
    },
    {
      name: 'godot_editor_filesystem_scan',
      title: 'Godot Editor Filesystem Scan',
      description: 'Trigger a Godot editor filesystem scan.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'safe',
      requiresEditor: true,
      execute: async () => callEditor(context, 'editor_filesystem_scan'),
    },
  ];
}
