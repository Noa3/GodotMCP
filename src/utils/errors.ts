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
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  BUSY: 'BUSY',
  RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details: Record<string, unknown>;
}
export function createErrorPayload(code: ErrorCode, message: string, details: Record<string, unknown> = {}): ErrorPayload {
  return { code, message, details };
}

/** Preserve engine errors instead of disguising validation/auth failures as disconnects. */
export function bridgeErrorPayload(error: { code: string; message: string; details: Record<string, unknown> } | null): ErrorPayload {
  if (!error) return createErrorPayload(ERROR_CODES.INTERNAL_ERROR, 'Bridge returned an error without details');
  const known = Object.values(ERROR_CODES).includes(error.code as ErrorCode);
  return createErrorPayload(known ? error.code as ErrorCode : ERROR_CODES.INTERNAL_ERROR, error.message,
    known ? error.details : { ...error.details, bridgeCode: error.code });
}

export function normalizeUnknownError(error: unknown, fallback = 'Internal error'): ErrorPayload {
  if (error instanceof Error) {
    return createErrorPayload(ERROR_CODES.INTERNAL_ERROR, error.message || fallback, { name: error.name, stack: error.stack ?? '' });
  }
  return createErrorPayload(ERROR_CODES.INTERNAL_ERROR, fallback, { value: typeof error === 'string' ? error : JSON.stringify(error) });
}
