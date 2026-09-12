import pino, { type Logger, type LoggerOptions } from 'pino';

/** stdout belongs exclusively to the MCP stdio transport. Never log credentials or tool payloads. */
export function createLogger(options: LoggerOptions = {}): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: 'godot-universal-mcp', pid: process.pid },
    ...options,
  }, pino.destination(2));
}

export const logger = createLogger();
