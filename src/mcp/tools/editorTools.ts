import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { getBridgeTools } from './bridgeTools';

export function getEditorTools(context: McpRuntimeContext): ToolDefinition[] {
  return getBridgeTools(context, 'editor');
}
