import { z } from 'zod';

export interface GodotRequest {
  id: string;
  type: 'request';
  tool: string;
  params: Record<string, unknown>;
  timeoutMs: number;
}

export interface GodotError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface GodotResponse {
  id: string;
  type: 'response';
  ok: boolean;
  result: unknown;
  error: GodotError | null;
}

export const GodotRequestSchema = z.object({
  id: z.string().min(1),
  type: z.literal('request'),
  tool: z.string().min(1),
  params: z.record(z.unknown()),
  timeoutMs: z.number().int().positive(),
});

export const GodotErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.unknown()),
});

export const GodotResponseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('response'),
  ok: z.boolean(),
  result: z.unknown(),
  error: GodotErrorSchema.nullable(),
});
