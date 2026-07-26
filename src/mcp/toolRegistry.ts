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

  public constructor(definitions: ToolDefinition[]) {
    const ordered = [...definitions].sort((left, right) => left.name.localeCompare(right.name));
    for (const definition of ordered) {
      this.tools.set(definition.name, definition);
    }
  }

  public list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public async call(name: string, params: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return errorResult(createErrorPayload(ERROR_CODES.TOOL_NOT_AVAILABLE, `Unknown tool: ${name}`));
    }

    try {
      const parsed = tool.schema.parse(params ?? {});
      return await tool.execute(parsed);
    } catch (error) {
      return formatCaughtError(error);
    }
  }
}

export function emptySchema(): ToolDefinition['schema'] {
  return z.object({});
}

export function buildToolRegistry(context: McpRuntimeContext): ToolRegistry {
  return new ToolRegistry([
    ...getProjectTools(context),
    ...getFileTools(context),
    ...getSceneTools(context),
    ...getScriptTools(context),
    ...getEditorTools(context),
    ...getRuntimeTools(context),
  ]);
}
