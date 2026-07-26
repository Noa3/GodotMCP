export const ERROR_CODES = {
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  INVALID_PROJECT: 'INVALID_PROJECT',
  PATH_OUTSIDE_PROJECT: 'PATH_OUTSIDE_PROJECT',
  PATH_DENIED: 'PATH_DENIED',
  GODOT_NOT_CONNECTED: 'GODOT_NOT_CONNECTED',
  GODOT_RUNTIME_NOT_CONNECTED: 'GODOT_RUNTIME_NOT_CONNECTED',
  TOOL_NOT_AVAILABLE: 'TOOL_NOT_AVAILABLE',
  TIMEOUT: 'TIMEOUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  WRITE_DISABLED: 'WRITE_DISABLED',
  DANGEROUS_TOOL_DISABLED: 'DANGEROUS_TOOL_DISABLED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details: Record<string, unknown>;
}

export function createErrorPayload(
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): ErrorPayload {
  return { code, message, details };
}

export function normalizeUnknownError(error: unknown, fallback = 'Internal error'): ErrorPayload {
  if (error instanceof Error) {
    return createErrorPayload(ERROR_CODES.INTERNAL_ERROR, error.message || fallback, {
      name: error.name,
      stack: error.stack ?? '',
    });
  }

  return createErrorPayload(ERROR_CODES.INTERNAL_ERROR, fallback, {
    value: typeof error === 'string' ? error : JSON.stringify(error),
  });
}
