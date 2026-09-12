import { z, type ZodType } from 'zod';
import type { McpRuntimeContext } from './context';
import type { ToolResult } from './toolUtils';
import { createErrorPayload, ERROR_CODES } from '../utils/errors';
import { errorResult, formatCaughtError } from './toolUtils';
import { getEditorTools } from './tools/editorTools';
import { getFileTools } from './tools/fileTools';
import { getProjectTools } from './tools/projectTools';
import { getRuntimeTools } from './tools/runtimeTools';
import { getSceneTools } from './tools/sceneTools';
import { getScriptTools } from './tools/scriptTools';

export type RiskLevel = 'safe' | 'write' | 'destructive';
export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  additionalProperties?: boolean;
  default?: unknown;
}
export interface ToolDefinition<T = any> {
  name: string;
  title: string;
  description: string;
  schema: ZodType<T>;
  inputSchema: JsonSchema;
  riskLevel: RiskLevel;
  requiresEditor?: boolean;
  requiresRuntime?: boolean;
  execute: (params: T) => Promise<ToolResult>;
}
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  public constructor(definitions: ToolDefinition[], private readonly authorize?: (tool: ToolDefinition) => Promise<boolean>) {
    for (const definition of [...definitions].sort((a, b) => a.name.localeCompare(b.name))) {
      if (this.tools.has(definition.name)) throw new Error(`Duplicate tool: ${definition.name}`);
      this.tools.set(definition.name, definition);
    }
  }
  public list(): ToolDefinition[] { return [...this.tools.values()]; }
  public get(name: string): ToolDefinition | undefined { return this.tools.get(name); }
  public async call(name: string, params: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return errorResult(createErrorPayload(ERROR_CODES.TOOL_NOT_AVAILABLE, `Unknown tool: ${name}`));
    try {
      const parsed = tool.schema.parse(params ?? {});
      if (this.authorize && !(await this.authorize(tool))) {
        return errorResult(createErrorPayload(ERROR_CODES.WRITE_DISABLED, 'This operation requires security.allowWrite=true and security.trustMode=trusted in the project config'));
      }
      return await tool.execute(parsed);
    } catch (error) { return formatCaughtError(error); }
  }
}
export function emptySchema(): ToolDefinition['schema'] { return z.object({}); }
export function buildToolRegistry(context: McpRuntimeContext): ToolRegistry {
  return new ToolRegistry([
    ...getProjectTools(context), ...getFileTools(context), ...getSceneTools(context),
    ...getScriptTools(context), ...getEditorTools(context), ...getRuntimeTools(context),
  ], async (tool) => {
    if (tool.riskLevel === 'safe') return true;
    const config = await context.getConfig();
    return config.security.allowWrite && config.security.trustMode === 'trusted';
  });
}
