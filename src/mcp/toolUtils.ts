import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError, type ZodType } from 'zod';
import { createErrorPayload, ERROR_CODES, normalizeUnknownError, type ErrorPayload } from '../utils/errors';

export interface TextContent { type: 'text'; text: string; }
export interface ImageContent { type: 'image'; mimeType: 'image/png'; data: string; }
export interface ToolResult extends CallToolResult {
  content: [TextContent, ...Array<TextContent | ImageContent>];
}
export function textResult(text: string): ToolResult { return { content: [{ type: 'text', text }] }; }
export function jsonResult(value: unknown): ToolResult { return textResult(JSON.stringify(value, null, 2)); }
export function imageResult(data: string, metadata: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(metadata, null, 2) }, { type: 'image', mimeType: 'image/png', data }], structuredContent: metadata };
}
export function errorResult(error: ErrorPayload): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error, null, 2) }], isError: true };
}
export function validateParams<T>(schema: ZodType<T>, params: unknown): T { return schema.parse(params ?? {}); }
export function formatCaughtError(error: unknown): ToolResult {
  if (error instanceof ZodError) return errorResult(createErrorPayload(ERROR_CODES.VALIDATION_ERROR, 'Invalid tool parameters', { issues: error.issues }));
  return errorResult(normalizeUnknownError(error));
}
