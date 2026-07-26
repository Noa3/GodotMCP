import pino, { type Logger, type LoggerOptions } from 'pino';

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: 'godot-universal-mcp',
      pid: process.pid,
    },
    ...options,
  });
}

export const logger = createLogger();
