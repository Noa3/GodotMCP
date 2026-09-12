import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { JsonSchema, RiskLevel } from '../mcp/toolRegistry';

export interface FieldSchema extends JsonSchema {
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
}
export interface BridgeToolSpec {
  name: string; target: 'editor' | 'runtime'; command?: string;
  operation?: 'run' | 'stop' | 'wait' | 'capture'; risk: RiskLevel;
  description: string; params: Record<string, string>; required?: string[];
}
export interface BridgeManifest { version: number; fields: Record<string, FieldSchema>; tools: BridgeToolSpec[]; }
export const bridgeManifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../addons/godot_universal_mcp/tool_manifest.json'), 'utf8')) as BridgeManifest;
if (bridgeManifest.version !== 1) throw new Error('Unsupported bridge manifest version');

export function toolInputSchema(spec: BridgeToolSpec): JsonSchema {
  const properties: Record<string, FieldSchema> = {};
  for (const [name, alias] of Object.entries(spec.params)) {
    if (!bridgeManifest.fields[alias]) throw new Error(`Unknown manifest field ${alias}`);
    properties[name] = { ...bridgeManifest.fields[alias] };
  }
  return { type: 'object', additionalProperties: false, properties, required: spec.required ?? [] };
}

export function toolValidator(spec: BridgeToolSpec): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, alias] of Object.entries(spec.params)) {
    const field = bridgeManifest.fields[alias];
    if (!field) throw new Error(`Unknown manifest field ${alias}`);
    let validator: z.ZodTypeAny;
    if (field.type === 'string') {
      let value = z.string();
      if (field.minLength !== undefined) value = value.min(field.minLength);
      if (field.maxLength !== undefined) value = value.max(field.maxLength);
      validator = field.enum ? value.refine((v) => field.enum!.includes(v), 'Unsupported value') : value;
    } else if (field.type === 'integer' || field.type === 'number') {
      let value = z.number().finite();
      if (field.type === 'integer') value = value.int();
      if (field.minimum !== undefined) value = value.min(field.minimum);
      if (field.maximum !== undefined) value = value.max(field.maximum);
      validator = value;
    } else if (field.type === 'boolean') validator = z.boolean();
    else if (field.type === undefined) validator = z.unknown();
    else throw new Error(`Unsupported manifest type ${field.type}`);
    shape[name] = spec.required?.includes(name) ? validator : validator.optional();
  }
  return z.object(shape).strict().superRefine((value, context) => {
    for (const name of spec.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, name) || value[name] === undefined) context.addIssue({ code: 'custom', path: [name], message: 'Required' });
    }
  });
}
