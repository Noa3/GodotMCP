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
import { logger } from '../utils/logger';

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
      logger.warn({ tool: name }, `[UNKNOWN_TOOL] Called unknown tool: ${name}`);
      return errorResult(createErrorPayload(ERROR_CODES.TOOL_NOT_AVAILABLE, `Unknown tool: ${name}`));
    }

    try {
      logger.info({ tool: name, risk: tool.riskLevel }, `[TOOL_CALL] ${tool.title} (params: ${JSON.stringify(params).slice(0, 200)})`);
      const parsed = tool.schema.parse(params ?? {});
      const result = await tool.execute(parsed);
      if (result.isError) {
        logger.warn({ tool: name }, `[TOOL_FAIL] ${name}: ${JSON.stringify(result).slice(0, 500)}`);
      } else {
        logger.info({ tool: name }, `[TOOL_OK] ${name} completed successfully`);
      }
      return result;
    } catch (error) {
      logger.error({ tool: name, error: error instanceof Error ? error.message : String(error) }, `[TOOL_ERROR] ${name}`);
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
